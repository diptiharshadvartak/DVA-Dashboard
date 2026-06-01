import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createPaymentLink, cancelPaymentLink, CashfreeError } from '@/lib/cashfree/client';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { emiId } = await req.json();
    if (!emiId) {
      return NextResponse.json({ ok: false, error: 'emiId required' }, { status: 400 });
    }

    // Auth + admin check
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = (profile as any)?.role === 'admin';
    if (!isAdmin) {
      // Allow coaches with EMI permission too
      const { data: profileFull } = await sb.from('profiles').select('permissions').eq('id', user.id).maybeSingle();
      const perms = (profileFull as any)?.permissions ?? [];
      if (!perms.includes('emi')) {
        return NextResponse.json({ ok: false, error: 'Forbidden — admin or EMI permission required' }, { status: 403 });
      }
    }

    // Load Cashfree credentials (admin client to bypass RLS)
    const admin = supabaseAdmin();
    const { data: settings } = await admin
      .from('ghl_settings')
      .select('cashfree_app_id, cashfree_secret_key, cashfree_env')
      .eq('id', 1)
      .maybeSingle();

    const appId = (settings as any)?.cashfree_app_id;
    const secretKey = (settings as any)?.cashfree_secret_key;
    const env = (settings as any)?.cashfree_env ?? 'sandbox';

    if (!appId || !secretKey) {
      return NextResponse.json({
        ok: false,
        error: 'Cashfree not configured. Add App ID and Secret Key in Settings → GHL Integration.',
      }, { status: 400 });
    }

    // Load EMI + student
    const { data: emi } = await admin
      .from('emi_schedule')
      .select('id, amount, due_date, installment_no, installments_total, student_id, status, cashfree_link_id, cashfree_link_status')
      .eq('id', emiId)
      .maybeSingle();
    if (!emi) {
      return NextResponse.json({ ok: false, error: 'EMI not found' }, { status: 404 });
    }
    if ((emi as any).status === 'paid') {
      return NextResponse.json({ ok: false, error: 'EMI is already paid' }, { status: 400 });
    }

    const { data: student } = await admin
      .from('students')
      .select('first_name, last_name, mobile, email')
      .eq('id', (emi as any).student_id)
      .maybeSingle();
    if (!student) {
      return NextResponse.json({ ok: false, error: 'Student not found' }, { status: 404 });
    }

    // Format Indian phone for Cashfree: requires +91XXXXXXXXXX
    const rawPhone: string = ((student as any).mobile ?? '').toString();
    // Strip everything except digits and a possible leading '+'
    const hasPlus = rawPhone.trim().startsWith('+');
    const digits = rawPhone.replace(/\D/g, '');
    let phone = '';
    if (hasPlus && digits.length >= 11) {
      phone = '+' + digits;
    } else if (digits.length === 10) {
      phone = '+91' + digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      phone = '+91' + digits.slice(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
      phone = '+' + digits;
    } else if (digits.length === 13 && digits.startsWith('091')) {
      phone = '+' + digits.slice(1);
    }
    if (!phone || phone.length < 13) {
      return NextResponse.json({ ok: false, error: 'Student has no valid phone number' }, { status: 400 });
    }

    // Build link
    const customerName = `${(student as any).first_name ?? ''} ${(student as any).last_name ?? ''}`.trim() || 'Student';
    const dueDateStr = new Date((emi as any).due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const purpose = `Diamond EMI ${(emi as any).installment_no}/${(emi as any).installments_total} due ${dueDateStr}`;

    // Unique link ID per EMI (allows regeneration if previous was cancelled)
    const linkId = `EMI_${emiId.replace(/-/g, '').slice(0, 16)}_${Date.now().toString(36)}`;

    // Expiry: 30 days from the later of (today, due_date) — overdue EMIs would otherwise expire in the past.
    // Format as IST 23:59:59 so Cashfree shows the expected calendar day to the customer.
    const dueMs = new Date((emi as any).due_date).getTime();
    const nowMs = Date.now();
    const base = new Date(Math.max(dueMs, nowMs));
    base.setUTCDate(base.getUTCDate() + 30);
    const yyyy = base.getUTCFullYear();
    const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(base.getUTCDate()).padStart(2, '0');
    const expiryIso = `${yyyy}-${mm}-${dd}T23:59:59+05:30`;

    // Webhook URL (where Cashfree will POST payment events). Prefer the
    // configured public app URL — the request host is "localhost" in dev, which
    // Cashfree (external) can't call back to, so the payment would never
    // auto-mark as paid. Fall back to the request host when it isn't set.
    const proto = req.headers.get('x-forwarded-proto') ?? 'https';
    const host = req.headers.get('host') ?? '';
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`).replace(/\/+$/, '');
    const notifyUrl = `${baseUrl}/api/cashfree/webhook`;

    // If a previous link exists and is still ACTIVE, cancel it first so the customer
    // can't pay an orphaned link whose webhook wouldn't match this EMI any more.
    // Best-effort: if cancel fails (already paid/expired/etc), proceed anyway.
    const prevLinkId = (emi as any).cashfree_link_id as string | null;
    const prevStatus = (emi as any).cashfree_link_status as string | null;
    if (prevLinkId && prevStatus === 'ACTIVE') {
      try {
        await cancelPaymentLink({ appId, secretKey, env }, prevLinkId);
        await admin.from('cashfree_events').insert({
          emi_id: emiId,
          student_id: (emi as any).student_id,
          event_type: 'link_cancelled',
          cashfree_link_id: prevLinkId,
          payload: { reason: 'superseded_by_regeneration' },
        } as any);
      } catch (e: any) {
        await admin.from('cashfree_events').insert({
          emi_id: emiId,
          student_id: (emi as any).student_id,
          event_type: 'link_cancel_failed',
          cashfree_link_id: prevLinkId,
          error: e?.message ?? 'unknown',
        } as any);
      }
    }

    // Call Cashfree
    let link;
    try {
      link = await createPaymentLink(
        { appId, secretKey, env },
        {
          linkId,
          amount: Number((emi as any).amount),
          purpose,
          customerName,
          customerPhone: phone,
          customerEmail: (student as any).email ?? undefined,
          expiryDate: expiryIso,
          notifyUrl,
        }
      );
    } catch (e: any) {
      // Log to audit table
      await admin.from('cashfree_events').insert({
        emi_id: emiId,
        student_id: (emi as any).student_id,
        event_type: 'link_create_failed',
        error: e?.message ?? 'unknown',
        payload: { linkId, amount: (emi as any).amount },
      } as any);
      return NextResponse.json({
        ok: false,
        error: e instanceof CashfreeError ? e.message : 'Failed to create Cashfree link',
      }, { status: 500 });
    }

    // Save to EMI
    await admin.from('emi_schedule').update({
      cashfree_link_id: link.link_id,
      cashfree_link_url: link.link_url,
      cashfree_link_status: link.link_status,
      cashfree_link_created_at: link.link_created_at,
      payment_link: link.link_url,   // also fill the generic payment_link field
    } as any).eq('id', emiId);

    // Audit log
    await admin.from('cashfree_events').insert({
      emi_id: emiId,
      student_id: (emi as any).student_id,
      event_type: 'link_created',
      cashfree_link_id: link.link_id,
      payload: { link_url: link.link_url, amount: link.link_amount },
    } as any);

    return NextResponse.json({
      ok: true,
      link_id: link.link_id,
      link_url: link.link_url,
      link_status: link.link_status,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}