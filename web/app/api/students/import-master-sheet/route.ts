import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ParsedRow = {
  email: string;
  first_name: string;
  last_name: string;
  mobile: string;
  membership: string;
  tags: string[];
  background: string;
  month_1: boolean;
  month_2: boolean;
  month_3: boolean;
  month_4: boolean;
  month_5: boolean;
  month_6: boolean;
  is_super_baker_finisher: boolean;
  is_hall_of_fame: boolean;
  certificate_issued: boolean;
  certificate_issued_date: string | null;
  bbr_attended: boolean;
  bbr_attended_date: string | null;
  call_logs?: { date: string | null; comment: string; coach_label: string }[];
  course_end_date?: string | null;
  course_start_date?: string | null;
};

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if ((profile as any)?.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }

  const { rows }: { rows: ParsedRow[] } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'No rows provided' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Find existing by email (unique identifier)
      const { data: existing } = await admin
        .from('students')
        .select('id, background')
        .eq('email', row.email)
        .maybeSingle();

      // Build the data payload (EMI / payment fields intentionally NOT included)
      const data: any = {
        first_name: row.first_name,
        last_name: row.last_name || null,
        mobile: row.mobile || null,
        membership: row.membership,
        tags: row.tags,
        background: row.background || null,
        month_1: row.month_1,
        month_2: row.month_2,
        month_3: row.month_3,
        month_4: row.month_4,
        month_5: row.month_5,
        month_6: row.month_6,
        is_super_baker_finisher: row.is_super_baker_finisher,
        is_hall_of_fame: row.is_hall_of_fame,
        certificate_issued: row.certificate_issued,
        certificate_issued_date: row.certificate_issued_date,
        bbr_attended: row.bbr_attended,
        bbr_attended_date: row.bbr_attended_date,
        ...(row.course_end_date ? { course_end_date: row.course_end_date } : {}),
        ...(row.course_start_date ? { course_start_date: row.course_start_date } : {}),
      };

      let studentId: string;
      if (existing) {
        // UPDATE — preserves emi_schedule, payment data, payment_link.
        // (Weekly checkpoints are materialized from the month flags below —
        // there is no DB trigger doing it.)
        const { error } = await admin
          .from('students')
          .update(data)
          .eq('id', (existing as any).id);
        if (error) throw error;
        studentId = (existing as any).id;
        updated++;
      } else {
        // INSERT new student
        const { data: created, error } = await admin
          .from('students')
          .insert({ ...data, email: row.email } as any)
          .select('id')
          .single();
        if (error) throw error;
        studentId = (created as any).id;
        inserted++;
      }

      // Import call logs (if present in the sheet)
      if (row.call_logs && row.call_logs.length > 0) {
        for (const call of row.call_logs) {
          // Dedup against the SAME stored form ("[label] comment") that we
          // insert below — matching the raw comment never hit, so re-imports
          // created duplicate call logs.
          const storedComment = `[${call.coach_label}] ${call.comment}`;
          const { data: dupe } = await admin
            .from('call_logs')
            .select('id')
            .eq('student_id', studentId)
            .eq('comment', storedComment)
            .maybeSingle();
          if (dupe) continue;

          const { error: clErr } = await admin.from('call_logs').insert({
            student_id: studentId,
            coach_id: user.id,  // importing admin as the logger
            comment: storedComment,
            outcome: 'connected',
            created_at: call.date ? new Date(call.date).toISOString() : new Date().toISOString(),
          } as any);
          if (clErr) errors.push(`${row.email}: a call log was not saved — ${clErr.message}`);
        }
      }

      // Materialize weekly checkpoints from the month flags. The Progress tab is
      // week-driven (4 weeks/month) and derives month completion from
      // weekly_checkpoints — there is no DB trigger syncing months → weeks, so
      // without this the imported months wouldn't show in the UI.
      const monthFlags = [row.month_1, row.month_2, row.month_3, row.month_4, row.month_5, row.month_6];
      const weekRows: any[] = [];
      monthFlags.forEach((done, idx) => {
        if (done) for (let w = 1; w <= 4; w++) weekRows.push({ student_id: studentId, week_no: idx * 4 + w, completed: true });
      });
      if (weekRows.length > 0) {
        const { error: wkErr } = await admin.from('weekly_checkpoints').upsert(weekRows as any, { onConflict: 'student_id,week_no' });
        if (wkErr) errors.push(`${row.email}: progress weeks not saved — ${wkErr.message}`);
      }
    } catch (e: any) {
      errors.push(`${row.email}: ${e.message ?? 'unknown error'}`);
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    errors: errors.length > 0 ? errors : undefined,
  });
}