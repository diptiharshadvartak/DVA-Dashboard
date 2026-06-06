import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cancelPaymentLink, CashfreeError } from '@/lib/cashfree/client';

export const runtime = 'nodejs';

// Undo a generated Cashfree link on an EMI: cancel it at Cashfree (so the
// student can't still pay an orphaned link) and clear the stored link fields so
// the row reverts to the "Get link" state. Mirrors the auth + credential
// handling of generate-link.
export async function POST(req: Request) {
  try {
    const { emiId } = await req.json();
    if (!emiId) {
      return NextResponse.json({ ok: false, error: 'emiId required' }, { status: 400 });
    }

    // Auth + admin/EMI-permission check (same gate as generate-link).
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = (profile as any)?.role === 'admin';
    if (!isAdmin) {
      const { data: profileFull } = await sb.from('profiles').select('permissions').eq('id', user.id).maybeSingle();
      const perms = (profileFull as any)?.permissions ?? [];
      if (!perms.includes('emi')) {
        return NextResponse.json({ ok: false, error: 'Forbidden — admin or EMI permission required' }, { status: 403 });
      }
    }

    const admin = supabaseAdmin();
    const { data: emi } = await admin
      .from('emi_schedule')
      .select('id, student_id, status, cashfree_link_id, cashfree_link_url, cashfree_link_status, payment_link')
      .eq('id', emiId)
      .maybeSingle();
    if (!emi) {
      return NextResponse.json({ ok: false, error: 'EMI not found' }, { status: 404 });
    }
    if ((emi as any).status === 'paid') {
      return NextResponse.json({ ok: false, error: 'EMI is already paid — link can\'t be removed' }, { status: 400 });
    }
    if (!(emi as any).cashfree_link_id && !(emi as any).cashfree_link_url) {
      return NextResponse.json({ ok: false, error: 'No Cashfree link on this installment' }, { status: 400 });
    }

    // Best-effort cancel at Cashfree if the link is still ACTIVE. If creds are
    // missing or the cancel fails (already expired/cancelled/etc), we still
    // clear the local fields — the point of "undo" is to remove it from the row.
    const linkId = (emi as any).cashfree_link_id as string | null;
    const linkStatus = (emi as any).cashfree_link_status as string | null;
    if (linkId && linkStatus === 'ACTIVE') {
      const { data: settings } = await admin
        .from('ghl_settings')
        .select('cashfree_app_id, cashfree_secret_key, cashfree_env')
        .eq('id', 1)
        .maybeSingle();
      const appId = (settings as any)?.cashfree_app_id;
      const secretKey = (settings as any)?.cashfree_secret_key;
      const env = (settings as any)?.cashfree_env ?? 'sandbox';
      if (appId && secretKey) {
        try {
          await cancelPaymentLink({ appId, secretKey, env }, linkId);
          await admin.from('cashfree_events').insert({
            emi_id: emiId,
            student_id: (emi as any).student_id,
            event_type: 'link_cancelled',
            cashfree_link_id: linkId,
            payload: { reason: 'undo_by_user' },
          } as any);
        } catch (e: any) {
          await admin.from('cashfree_events').insert({
            emi_id: emiId,
            student_id: (emi as any).student_id,
            event_type: 'link_cancel_failed',
            cashfree_link_id: linkId,
            error: e instanceof CashfreeError ? e.message : (e?.message ?? 'unknown'),
          } as any);
        }
      }
    }

    // Clear the link fields. Only clear the generic payment_link when it is the
    // Cashfree link we generated (don't wipe a separately-set reference). Guard
    // on status so a webhook marking it paid in the meantime isn't clobbered.
    const clearGeneric = (emi as any).payment_link && (emi as any).payment_link === (emi as any).cashfree_link_url;
    await admin.from('emi_schedule').update({
      cashfree_link_id: null,
      cashfree_link_url: null,
      cashfree_link_status: null,
      cashfree_link_created_at: null,
      ...(clearGeneric ? { payment_link: null } : {}),
    } as any).eq('id', emiId).neq('status', 'paid');

    await admin.from('cashfree_events').insert({
      emi_id: emiId,
      student_id: (emi as any).student_id,
      event_type: 'link_removed',
      cashfree_link_id: linkId,
    } as any);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Internal error' }, { status: 500 });
  }
}
