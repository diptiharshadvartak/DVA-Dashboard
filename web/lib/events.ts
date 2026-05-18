// Reminder dispatch + sweep helpers used by cron routes and manual trigger API.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlTriggerWorkflow, GhlError } from '@/lib/ghl/client';
import { normalizePhone } from '@/lib/utils';

type AnyClient = SupabaseClient<any, any, any>;

function isWebhookUrl(v: string | null | undefined): boolean {
  return !!v && (v.startsWith('http://') || v.startsWith('https://'));
}

export async function dispatchReminder(sb: AnyClient, args: {
  event: string;
  studentId: string;
  emiId?: string;
  ghlContactId: string | null;
  workflowId: string | null;
  payload: Record<string, unknown>;
  triggeredBy: string | null;
  channel?: 'whatsapp' | 'sms' | 'email';
}) {
  const insert = {
    event_id: args.event,
    student_id: args.studentId,
    emi_id: args.emiId ?? null,
    ghl_workflow_id: args.workflowId,
    ghl_contact_id: args.ghlContactId,
    channel: args.channel ?? 'whatsapp',
    payload: args.payload,
    status: 'queued' as const,
    triggered_by: args.triggeredBy,
  };

  const { data: row, error: insertErr } = await sb
    .from('reminders').insert(insert).select('id').single();
  if (insertErr) return { ok: false, error: insertErr.message };

  if (!args.workflowId) {
    await sb.from('reminders').update({
      status: 'failed',
      error: 'workflow_id missing — set it on the Reminders page',
    }).eq('id', row.id);
    return { ok: false, reminderId: row.id, error: 'workflow_id missing' };
  }

  if (!isWebhookUrl(args.workflowId) && !args.ghlContactId) {
    await sb.from('reminders').update({
      status: 'failed',
      error: 'ghl_contact_id missing — run Pull from GHL, or switch this event to a webhook URL',
    }).eq('id', row.id);
    return { ok: false, reminderId: row.id, error: 'ghl_contact_id missing' };
  }

  try {
    await ghlTriggerWorkflow(args.ghlContactId, args.workflowId, args.payload);
    await sb.from('reminders').update({
      status: 'sent', fired_at: new Date().toISOString(),
    }).eq('id', row.id);
    return { ok: true, reminderId: row.id };
  } catch (e: any) {
    const msg = e instanceof GhlError ? e.message : (e?.message ?? 'unknown');
    await sb.from('reminders').update({ status: 'failed', error: msg }).eq('id', row.id);
    return { ok: false, reminderId: row.id, error: msg };
  }
}

export async function fireReminder(_event: string, _row: any) {
  return null;
}

export async function sweepEmiRemindersDue(sb: AnyClient, workflowId: string | null): Promise<number> {
  // Mark EMIs that are due today as 'due_soon' if still 'upcoming'
  const today = new Date().toISOString().slice(0, 10);
  await sb
    .from('emi_schedule')
    .update({ status: 'due_soon', updated_at: new Date().toISOString() } as any)
    .eq('due_date', today)
    .eq('status', 'upcoming');

  const { data: rows } = await sb.from('v_emi_due_today').select('*');
  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
    const dup = await sb.from('reminders').select('id')
      .eq('emi_id', r.id).in('status', ['queued', 'sent', 'delivered']).maybeSingle();
    if (dup.data) continue;
    // Fetch payment link with priority: Cashfree link for THIS EMI > EMI generic link > student default
    const { data: emiRow } = await sb.from('emi_schedule').select('cashfree_link_url, payment_link').eq('id', r.id).maybeSingle();
    const { data: stuRow } = await sb.from('students').select('payment_link').eq('id', r.student_id).maybeSingle();
    const paymentLink =
      (emiRow as any)?.cashfree_link_url
      || (emiRow as any)?.payment_link
      || (stuRow as any)?.payment_link
      || null;

    const out = await dispatchReminder(sb, {
      event: 'emi.reminder_due',
      studentId: r.student_id,
      emiId: r.id,
      ghlContactId: r.ghl_contact_id ?? null,
      workflowId,
      payload: {
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: normalizePhone(r.mobile),
        amount: r.amount,
        due_date: r.due_date,
        installment: `${r.installment_no}/${r.installments_total}`,
        payment_link: paymentLink,
      },
      triggeredBy: null,
    });
    if (out.ok) fired++;
  }
  return fired;
}

export async function sweepEmiOverdue(sb: AnyClient, workflowId: string | null): Promise<number> {
  // 1. Update status from 'upcoming' to 'overdue' for any EMIs past their due date.
  // This keeps emi_schedule.status in sync with reality (used by UI filters & badges).
  const today = new Date().toISOString().slice(0, 10);
  await sb
    .from('emi_schedule')
    .update({ status: 'overdue', updated_at: new Date().toISOString() } as any)
    .lt('due_date', today)
    .in('status', ['upcoming', 'due_soon']);

  // 2. Read the view (uses freshly-updated status) and send WhatsApp reminders.
  const { data: rows } = await sb.from('v_emi_overdue').select('*');
  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
    const { data: emiRow2 } = await sb.from('emi_schedule').select('cashfree_link_url, payment_link').eq('id', r.id).maybeSingle();
    const { data: stuRow2 } = await sb.from('students').select('payment_link').eq('id', r.student_id).maybeSingle();
    const paymentLink2 =
      (emiRow2 as any)?.cashfree_link_url
      || (emiRow2 as any)?.payment_link
      || (stuRow2 as any)?.payment_link
      || null;

    const out = await dispatchReminder(sb, {
      event: 'emi.overdue',
      studentId: r.student_id,
      emiId: r.id,
      ghlContactId: r.ghl_contact_id ?? null,
      workflowId,
      payload: {
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: normalizePhone(r.mobile),
        amount: r.amount,
        due_date: r.due_date,
        payment_link: paymentLink2,
      },
      triggeredBy: null,
    });
    if (out.ok) fired++;
  }
  return fired;
}

export async function sweepSilentStudents(sb: AnyClient, workflowId: string | null): Promise<number> {
  const { data: rows } = await sb.from('v_students_silent_30d').select('*');
  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
    const out = await dispatchReminder(sb, {
      event: 'student.no_call_30d',
      studentId: r.id,
      ghlContactId: r.ghl_contact_id ?? null,
      workflowId,
      payload: {
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: normalizePhone(r.mobile),
        last_touch: r.last_touch,
      },
      triggeredBy: null,
    });
    if (out.ok) fired++;
  }
  return fired;
}

// Sweep follow-ups whose next_action_due hits TODAY. Fires a WhatsApp to the
// student via the configured GHL workflow. Deduped via the reminders table —
// a follow-up that already has a "sent" reminder won't re-fire.
export async function sweepFollowupsDue(sb: AnyClient, workflowId: string | null): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows } = await sb
    .from('call_logs')
    .select(`
      id, student_id, next_action, next_action_due,
      student:students(first_name, last_name, email, mobile, ghl_contact_id)
    `)
    .eq('next_action_due', today)
    .not('next_action', 'is', null);

  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
    if (!r.student) continue;

    // Skip if already fired for this call_log id
    const dup = await sb.from('reminders').select('id')
      .eq('event_id', 'student.followup_due')
      .contains('payload', { call_log_id: r.id })
      .in('status', ['queued', 'sent', 'delivered'])
      .maybeSingle();
    if (dup.data) continue;

    const out = await dispatchReminder(sb, {
      event: 'student.followup_due',
      studentId: r.student_id,
      ghlContactId: r.student.ghl_contact_id ?? null,
      workflowId,
      payload: {
        email: r.student.email,
        first_name: r.student.first_name,
        last_name: r.student.last_name,
        phone: normalizePhone(r.student.mobile),
        next_action: r.next_action,
        due_date: r.next_action_due,
        call_log_id: r.id,
      },
      triggeredBy: null,
    });
    if (out.ok) fired++;
  }
  return fired;
}