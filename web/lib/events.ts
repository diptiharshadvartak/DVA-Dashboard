// Reminder dispatch + sweep helpers used by cron routes and manual trigger API.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ghlTriggerWorkflow, ghlUpsertContact, GhlError } from '@/lib/ghl/client';
import { normalizePhone, istDateString, selectAllRows } from '@/lib/utils';

type AnyClient = SupabaseClient<any, any, any>;

function isWebhookUrl(v: string | null | undefined): boolean {
  return !!v && (v.startsWith('http://') || v.startsWith('https://'));
}

// Pick the GHL workflow/template for a reminder based on the student's payment
// type. If the event has a workflow mapped for that exact type, use it; else
// fall back to the event's default workflow. This is what routes UPI students to
// the UPI flow, NEFT students to the NEFT flow, etc.
export function resolveWorkflowId(
  ev: { default_workflow_id: string | null; workflow_by_payment_type?: Record<string, string> | null } | null | undefined,
  paymentType: string | null | undefined,
): string | null {
  if (!ev) return null;
  const map = ev.workflow_by_payment_type ?? null;
  const key = (paymentType ?? '').trim();
  if (map && key) {
    const v = (map as Record<string, string>)[key];
    if (v && String(v).trim()) return String(v).trim();
  }
  return ev.default_workflow_id ?? null;
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

  // Workflow-ID mode needs a GHL contact. Students imported/added here don't
  // have one, so create it on the fly from the payload (email/phone/name) and
  // remember it on the student — this lets us message them without a separate
  // "Pull from GHL" step. Webhook-URL mode needs no contact, so skip this.
  let contactId = args.ghlContactId;
  if (!isWebhookUrl(args.workflowId) && !contactId) {
    const p = args.payload as Record<string, any>;
    if (p?.email) {
      try {
        const res = await ghlUpsertContact({
          email: String(p.email),
          firstName: p.first_name ?? null,
          lastName: p.last_name ?? null,
          phone: p.phone ?? null,
        });
        contactId = res?.contact?.id ?? null;
        if (contactId) {
          await sb.from('students').update({ ghl_contact_id: contactId }).eq('id', args.studentId);
        }
      } catch {
        // Fall through to the missing-contact failure below (e.g. GHL token
        // not configured) — the recorded error tells the user what to fix.
      }
    }
  }

  if (!isWebhookUrl(args.workflowId) && !contactId) {
    await sb.from('reminders').update({
      status: 'failed',
      error: 'ghl_contact_id missing — set the GHL token in Settings, run Pull from GHL, or switch this event to a webhook URL',
    }).eq('id', row.id);
    return { ok: false, reminderId: row.id, error: 'ghl_contact_id missing' };
  }

  try {
    await ghlTriggerWorkflow(contactId, args.workflowId, args.payload);
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

export async function sweepEmiRemindersDue(
  sb: AnyClient,
  workflowId: string | null,
  workflowByPaymentType: Record<string, string> | null = null,
): Promise<number> {
  const wfCfg = { default_workflow_id: workflowId, workflow_by_payment_type: workflowByPaymentType };
  // Keep marking EMIs due TODAY as 'due_soon' for the UI badge/filter — unchanged.
  const today = istDateString();
  await sb
    .from('emi_schedule')
    .update({ status: 'due_soon', updated_at: new Date().toISOString() } as any)
    .eq('due_date', today)
    .eq('status', 'upcoming');

  // Reminders fire 2 DAYS BEFORE the due date (this event is "EMI reminder
  // (2 days before due)"). Pull the installments whose due date is exactly two
  // days out, joining the student for the contact fields the workflow needs.
  // Paginated so a backlog of >1000 rows doesn't silently skip the tail.
  // Anchor on the IST calendar date (midnight IST) before adding 2 days, so the
  // target is "today(IST) + 2 days" regardless of the hour the cron runs or is
  // retried at. The old `now + 48h` instant only landed on the right date
  // because the job happened to run mid-morning IST; a retry/back-fill at another
  // hour would select the wrong due_date (skip a day or remind on the wrong one).
  const remindOn = istDateString(new Date(Date.parse(istDateString() + 'T00:00:00+05:30') + 2 * 86400000));
  const rows = await selectAllRows((f, t) =>
    sb.from('emi_schedule')
      .select('id, student_id, amount, due_date, installment_no, installments_total, cashfree_link_url, payment_link, students!inner(ghl_contact_id, email, first_name, last_name, mobile, payment_link, payment_type)')
      .eq('due_date', remindOn)
      .neq('status', 'paid')
      .neq('status', 'cancelled')
      // Never remind soft-deleted students. Deleting a student only sets
      // deleted_at (no EMI cascade), so their installments survive and would
      // otherwise still fire here even though they're hidden everywhere in the UI.
      .is('students.deleted_at', null)
      .order('id')
      .range(f, t),
  );
  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
   try {
    const stu = r.students ?? {};
    // Idempotent: skip if a reminder for this EMI is already queued/sent. Use
    // limit(1), NOT maybeSingle — maybeSingle ERRORS when 2+ rows match, and the
    // old code read only dup.data, so once an EMI had several historical
    // reminders the guard was bypassed and it re-sent on every sweep. Treat a
    // query error as "skip" so a transient failure can't trigger a double-send.
    const dup = await sb.from('reminders').select('id')
      .eq('emi_id', r.id).in('status', ['queued', 'sent', 'delivered']).limit(1);
    if (dup.error || (dup.data && dup.data.length > 0)) continue;

    // Payment link priority: Cashfree link for THIS EMI > EMI generic link > student default.
    const paymentLink = r.cashfree_link_url || r.payment_link || stu.payment_link || null;

    const out = await dispatchReminder(sb, {
      event: 'emi.reminder_due',
      studentId: r.student_id,
      emiId: r.id,
      ghlContactId: stu.ghl_contact_id ?? null,
      workflowId: resolveWorkflowId(wfCfg, stu.payment_type),
      payload: {
        email: stu.email,
        first_name: stu.first_name,
        last_name: stu.last_name,
        phone: normalizePhone(stu.mobile),
        // GHL's inbound-webhook contact action reads `emi_amount` and
        // `payment_method`; keep `amount`/`payment_type` too for any older map.
        amount: r.amount,
        emi_amount: r.amount,
        due_date: r.due_date,
        installment: `${r.installment_no}/${r.installments_total}`,
        payment_link: paymentLink,
        payment_type: stu.payment_type ?? null,
        payment_method: stu.payment_type ?? null,
      },
      triggeredBy: null,
    });
    if (out.ok) fired++;
   } catch { /* one bad row shouldn't abort the rest of the day's sweep */ }
  }
  return fired;
}

export async function sweepEmiOverdue(sb: AnyClient, workflowId: string | null): Promise<number> {
  // 1. Update status from 'upcoming' to 'overdue' for any EMIs past their due date.
  // This keeps emi_schedule.status in sync with reality (used by UI filters & badges).
  const today = istDateString();
  await sb
    .from('emi_schedule')
    .update({ status: 'overdue', updated_at: new Date().toISOString() } as any)
    .lt('due_date', today)
    .in('status', ['upcoming', 'due_soon']);

  // 2. Read the view (uses freshly-updated status) and send WhatsApp reminders.
  //    Paginate so a backlog of >1000 overdue rows doesn't skip the tail.
  const rows = await selectAllRows((f, t) => sb.from('v_emi_overdue').select('*').order('id').range(f, t));
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
  const rows = await selectAllRows((f, t) => sb.from('v_students_silent_30d').select('*').order('id').range(f, t));
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
  const today = istDateString();
  const { data: rows } = await sb
    .from('call_logs')
    .select(`
      id, student_id, next_action, next_action_due,
      student:students(first_name, last_name, email, mobile, ghl_contact_id, deleted_at)
    `)
    .eq('next_action_due', today)
    .not('next_action', 'is', null);

  let fired = 0;
  for (const r of (rows ?? []) as any[]) {
    if (!r.student) continue;
    // Skip soft-deleted students (the embed is a left join, so a row survives
    // here even after the student is deleted — guard explicitly).
    if (r.student.deleted_at) continue;

    // Skip if already fired for this call_log id
    const dup = await sb.from('reminders').select('id')
      .eq('event_id', 'student.followup_due')
      .contains('payload', { call_log_id: r.id })
      .in('status', ['queued', 'sent', 'delivered'])
      .limit(1);
    // limit(1) + error-as-skip: maybeSingle errored (and bypassed the guard)
    // once a follow-up had 2+ reminders, causing repeat sends.
    if (dup.error || (dup.data && dup.data.length > 0)) continue;

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