import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getMyPermissions } from '@/lib/check-permission';
import { dispatchReminder, resolveWorkflowId } from '@/lib/events';
import { normalizePhone } from '@/lib/utils';

// POST /api/ghl/trigger-workflow
// body: { studentId, emiId?, channel?, payload?, eventId? }
// Inserts a `reminders` row and fires the relevant GHL workflow.
//
// The payload is enriched with the student's email/name/phone so that
// webhook-style workflows can identify or create the contact on GHL's side
// without needing a pre-imported ghl_contact_id. Phone is normalized to
// E.164 (e.g. "+917993499776") so WhatsApp/SMS can actually deliver.

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse('unauthenticated', { status: 401 });
  const { has } = await getMyPermissions();
  if (!has('send-reminders')) return new NextResponse('forbidden — Send Reminders permission required', { status: 403 });

  const body = (await req.json()) as {
    studentId: string;
    emiId?: string;
    channel?: 'whatsapp' | 'sms' | 'email';
    payload?: Record<string, unknown>;
    eventId?: string;
    paymentType?: string | null;
  };
  if (!body.studentId) return new NextResponse('studentId required', { status: 400 });

  const { data: student } = await sb
    .from('students')
    .select('id, ghl_contact_id, first_name, last_name, email, mobile, payment_type, deleted_at')
    .eq('id', body.studentId)
    .maybeSingle();
  if (!student) return new NextResponse('student not found', { status: 404 });
  // Deleted students are hidden across the UI; never message them even if a
  // stale client (or direct API call) targets one.
  if ((student as any).deleted_at) return new NextResponse('student is deleted', { status: 410 });

  const eventId = (body.eventId ?? 'emi.reminder_due') as any;

  const { data: ev } = await sb
    .from('reminder_events')
    .select('default_workflow_id, workflow_by_payment_type')
    .eq('id', eventId)
    .maybeSingle();
  // Route to the workflow/template mapped to the chosen payment type (the send
  // modal may override the student's saved type), else the event default.
  const effectiveType = body.paymentType ?? (student as any).payment_type;
  const workflowId = resolveWorkflowId(ev as any, effectiveType);

  // Normalize phone before forwarding to GHL.
  const normalizedPhone = normalizePhone(student.mobile);

  // Authoritative student fields from the DB go LAST so they override anything
  // the client sent. Previously body.payload was spread last, so the modal's
  // raw, un-normalized phone clobbered normalizedPhone — and a badly formatted
  // phone makes GHL/WhatsApp silently not deliver. The client's message fields
  // (emi_amount, payment_link, due_date, installment) are still preserved.
  const enrichedPayload = {
    ...(body.payload ?? {}),
    student_id: student.id,
    email: student.email,
    first_name: student.first_name,
    last_name: student.last_name,
    phone: normalizedPhone,
  };

  const result = await dispatchReminder(sb, {
    event: eventId,
    studentId: student.id,
    emiId: body.emiId ?? undefined,
    ghlContactId: student.ghl_contact_id ?? null,
    workflowId,
    payload: enrichedPayload,
    triggeredBy: user.id,
    channel: body.channel ?? 'whatsapp',
  });

  return NextResponse.json(result);
}