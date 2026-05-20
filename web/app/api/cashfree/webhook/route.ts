import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyWebhookSignature } from '@/lib/cashfree/client';

export const runtime = 'nodejs';

// Cashfree sends POST with these headers + JSON body:
//   x-webhook-signature: HMAC-SHA256(timestamp + raw_body, secret) base64
//   x-webhook-timestamp: unix seconds
// Body example:
//   { type: 'PAYMENT_LINK_EVENT',
//     data: { link_id, link_status, customer_details, link_amount, ... } }

export async function POST(req: Request) {
  const rawBody = await req.text();
  // Trim header values — some intermediaries append \r\n which breaks the
  // string-length precheck in verifyWebhookSignature and silently rejects valid sigs.
  const signature = (req.headers.get('x-webhook-signature') ?? '').trim();
  const timestamp = (req.headers.get('x-webhook-timestamp') ?? '').trim();

  const admin = supabaseAdmin();

  // Load webhook secret
  const { data: settings } = await admin
    .from('ghl_settings')
    .select('cashfree_webhook_secret')
    .eq('id', 1)
    .maybeSingle();

  const webhookSecret = (settings as any)?.cashfree_webhook_secret;

  if (webhookSecret) {
    // Verify signature
    const valid = verifyWebhookSignature(webhookSecret, timestamp, rawBody, signature);
    if (!valid) {
      console.error('[cashfree webhook] Invalid signature');
      await admin.from('cashfree_events').insert({
        event_type: 'webhook_invalid_signature',
        payload: { rawBody: rawBody.substring(0, 500) },
        error: 'Invalid signature',
      } as any);
      return new NextResponse('Invalid signature', { status: 401 });
    }
  } else {
    console.warn('[cashfree webhook] No webhook secret configured — processing unverified request');
    await admin.from('cashfree_events').insert({
      event_type: 'webhook_unverified',
      payload: { rawBody: rawBody.substring(0, 500) },
      error: 'No webhook secret configured',
    } as any);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  const eventType = parsed?.type ?? 'unknown';
  const data = parsed?.data ?? {};

  // Cashfree sends two shapes against the same notify_url:
  //   • PAYMENT_LINK_EVENT     → { data: { link_id, link_status, ... } }
  //   • PAYMENT_SUCCESS_WEBHOOK → { data: { order: { order_id, order_tags, order_status }, payment: { payment_status, ... } } }
  // Pull link_id from any of the known paths so order webhooks resolve too.
  const linkId =
    data?.link_id
    ?? data?.cf_link_id
    ?? data?.order?.order_tags?.link_id
    ?? data?.order?.order_tags?.cf_link_id
    ?? data?.order?.order_id
    ?? null;

  const linkStatus = data?.link_status ?? null;
  const orderStatus =
    data?.order_status
    ?? data?.payment_status
    ?? data?.order?.order_status
    ?? data?.payment?.payment_status
    ?? null;

  // Find matching EMI by cashfree_link_id
  if (!linkId) {
    await admin.from('cashfree_events').insert({
      event_type: 'webhook_no_link_id',
      payload: parsed,
    } as any);
    return NextResponse.json({ ok: true, note: 'No link_id in payload' });
  }

  const { data: emi } = await admin
    .from('emi_schedule')
    .select('id, student_id, status, amount, installment_no, installments_total')
    .eq('cashfree_link_id', linkId)
    .maybeSingle();

  if (!emi) {
    await admin.from('cashfree_events').insert({
      event_type: 'webhook_no_matching_emi',
      cashfree_link_id: linkId,
      payload: parsed,
    } as any);
    return NextResponse.json({ ok: true, note: 'No matching EMI' });
  }

  // Log webhook receipt
  await admin.from('cashfree_events').insert({
    emi_id: (emi as any).id,
    student_id: (emi as any).student_id,
    event_type: 'webhook_received',
    cashfree_link_id: linkId,
    payload: parsed,
  } as any);

  // Update Cashfree status
  if (linkStatus) {
    await admin.from('emi_schedule').update({
      cashfree_link_status: linkStatus,
    } as any).eq('id', (emi as any).id);
  }

  // If payment succeeded → auto-mark EMI as paid.
  // PAYMENT_SUCCESS_WEBHOOK alone isn't enough — Cashfree also fires it on
  // failed-payment-attempts where data.payment.payment_status === 'FAILED'.
  // Require either an explicit PAID link_status, or an order/payment status
  // that's actually a success terminal.
  const orderOrPaymentSuccess = orderStatus === 'PAID' || orderStatus === 'SUCCESS';
  const isPaymentSuccess =
    (eventType === 'PAYMENT_LINK_EVENT' && linkStatus === 'PAID')
    || (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && orderOrPaymentSuccess)
    || orderOrPaymentSuccess;

  if (isPaymentSuccess) {
    // Atomic: only mark paid + log audit if this EMI wasn't already paid.
    // Cashfree retries on transient failures, so two concurrent webhooks for the
    // same payment can both pass an in-memory `status !== 'paid'` check and produce
    // duplicate audit rows. Conditioning the UPDATE on the DB side serializes them.
    const update: Record<string, any> = {
      status: 'paid',
      paid_date: new Date().toISOString().slice(0, 10),
      payment_mode: 'Cashfree',
    };
    // Only overwrite payment_link if Cashfree actually included one in this event —
    // some webhook variants omit `link_url`, and we don't want to NULL out the
    // existing reference in that case.
    if (data?.link_url) update.payment_link = data.link_url;

    const { data: updatedRows } = await admin
      .from('emi_schedule')
      .update(update as any)
      .eq('id', (emi as any).id)
      .neq('status', 'paid')
      .select('id');

    if (updatedRows && updatedRows.length > 0) {
      await admin.from('cashfree_events').insert({
        emi_id: (emi as any).id,
        student_id: (emi as any).student_id,
        event_type: 'payment_success',
        cashfree_link_id: linkId,
        payload: { amount: (emi as any).amount, marked_paid: true },
      } as any);
    }
  }

  return NextResponse.json({ ok: true });
}

// GET endpoint for Cashfree to verify the URL is reachable
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Cashfree webhook endpoint' });
}