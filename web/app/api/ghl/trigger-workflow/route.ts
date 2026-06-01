import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { dispatchReminder } from '@/lib/events';
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

  const body = (await req.json()) as {
    studentId: string;
    emiId?: string;
    channel?: 'whatsapp' | 'sms' | 'email';
    payload?: Record<string, unknown>;
    eventId?: string;
  };
  if (!body.studentId) return new NextResponse('studentId required', { status: 400 });

  const { data: student } = await sb
    .from('students')
    .select('id, ghl_contact_id, first_name, last_name, email, mobile')
    .eq('id', body.studentId)
    .maybeSingle();
  if (!student) return new NextResponse('student not found', { status: 404 });

  const eventId = (body.eventId ?? 'emi.reminder_due') as any;

  const { data: ev } = await sb
    .from('reminder_events')
    .select('default_workflow_id')
    .eq('id', eventId)
    .maybeSingle();
  const workflowId = ev?.default_workflow_id ?? null;

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