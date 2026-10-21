import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyWebhookSignature } from '@/lib/cashfree/client';
import { istDateString } from '@/lib/utils';
import { backfillPaymentType } from '@/lib/payment-types';

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

  // Cashfree signs webhooks with the API Secret Key, so that is the secret.
  // A separately stored cashfree_webhook_secret (older setups) is still
  // accepted as a fallback.
  const { data: settings } = await admin
    .from('ghl_settings')
    .select('cashfree_secret_key, cashfree_webhook_secret')
    .eq('id', 1)
    .maybeSingle();

  const secrets = [
    (settings as any)?.cashfree_secret_key,
    (settings as any)?.cashfree_webhook_secret,
  ].filter((s): s is string => !!s);

  if (secrets.length > 0) {
    // Verify signature
    const valid = secrets.some((s) => verifyWebhookSignature(s, timestamp, rawBody, signature));
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
    // No secret configured → we cannot trust this request. Log it but do NOT
    // process it (previously it fell through and could auto-mark EMIs paid from
    // an unauthenticated caller). Save the Cashfree Secret Key in Settings to enable.
    console.warn('[cashfree webhook] No Cashfree Secret Key saved — ignoring unverified request');
    await admin.from('cashfree_events').insert({
      event_type: 'webhook_unverified',
      payload: { rawBody: rawBody.substring(0, 500) },
      error: 'No Cashfree Secret Key saved — save it in Settings to enable auto-mark-paid',
    } as any);
    return NextResponse.json({ ok: true, note: 'Cashfree Secret Key not saved; request ignored' });
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
  // Require a recognized success event — NOT a bare order/payment status, which
  // previously let any event with status PAID/SUCCESS (even a link-status event
  // for an unrelated state) mark the EMI paid.
  const orderOrPaymentSuccess = orderStatus === 'PAID' || orderStatus === 'SUCCESS';
  const isPaymentSuccess =
    (eventType === 'PAYMENT_LINK_EVENT' && linkStatus === 'PAID')
    || (eventType === 'PAYMENT_SUCCESS_WEBHOOK' && orderOrPaymentSuccess);

  if (isPaymentSuccess) {
    // Atomic: only mark paid + log audit if this EMI wasn't already paid.
    // Cashfree retries on transient failures, so two concurrent webhooks for the
    // same payment can both pass an in-memory `status !== 'paid'` check and produce
    // duplicate audit rows. Conditioning the UPDATE on the DB side serializes them.
    const update: Record<string, any> = {
      status: 'paid',
      paid_date: istDateString(),
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

      // First payment establishes the student's preferred payment type (if
      // unset) — use the actual method Cashfree reports (upi/card/net_banking/…).
      const cfMethod = data?.payment?.payment_group ?? data?.payment_group ?? null;
      await backfillPaymentType(admin, (emi as any).student_id, cfMethod);
    }
  }

  return NextResponse.json({ ok: true });
}

// GET endpoint for Cashfree to verify the URL is reachable
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Cashfree webhook endpoint' });
}