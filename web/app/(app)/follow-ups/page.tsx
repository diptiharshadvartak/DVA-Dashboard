import { supabaseServer } from '@/lib/supabase/server';
import { FollowupsClient } from './followups-client';
import { requirePermission } from '@/lib/check-permission';
import { chunk } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage() {
  await requirePermission('follow-ups');
  const sb = supabaseServer();

  // Fetch all follow-ups (call_logs with next_action set)
  const { data: rows } = await sb
    .from('call_logs')
    .select(`
      id, student_id, comment, outcome, next_action, next_action_due, created_at,
      coach:profiles(display_name, initials),
      student:students(first_name, last_name, email, mobile)
    `)
    .not('next_action', 'is', null)
    .not('next_action_due', 'is', null)
    .order('next_action_due', { ascending: true });

  const allRows = (rows ?? []) as any[];

  // Fetch ALL call_logs for these students to find the latest call per student
  const studentIds = Array.from(new Set(allRows.map((r) => r.student_id)));
  const latestCallPerStudent: Record<string, string> = {};
  if (studentIds.length > 0) {
    // Query in batches — a single .in() with hundreds of ids overflows the
    // request URL and fails outright (this is the same bug that blanked the
    // Students table). Each id is in one batch, so the merge stays correct.
    const callResults = await Promise.all(
      chunk(studentIds, 50).map((ids) =>
        sb.from('call_logs').select('student_id, created_at').in('student_id', ids)
      )
    );
    for (const { data: allCalls } of callResults) {
      for (const c of ((allCalls ?? []) as any[])) {
        const cur = latestCallPerStudent[c.student_id];
        if (!cur || new Date(c.created_at).getTime() > new Date(cur).getTime()) {
          latestCallPerStudent[c.student_id] = c.created_at;
        }
      }
    }
  }

  const items = allRows.map((r) => {
    // "Completed" = a NEWER call exists for this student (after the follow-up was set)
    const latestCall = latestCallPerStudent[r.student_id];
    const hasNewerCall = latestCall && new Date(latestCall).getTime() > new Date(r.created_at).getTime();

    return {
      id: r.id,
      student_id: r.student_id,
      comment: r.comment,
      outcome: r.outcome,
      next_action: r.next_action,
      next_action_due: r.next_action_due,
      created_at: r.created_at,
      coach_initials: r.coach?.initials ?? null,
      coach_name: r.coach?.display_name ?? null,
      student_first: r.student?.first_name ?? null,
      student_last: r.student?.last_name ?? null,
      student_email: r.student?.email ?? '',
      student_mobile: r.student?.mobile ?? null,
      is_completed: !!hasNewerCall,
      completed_at: hasNewerCall ? latestCall : null,
    };
  });

  return (
    <div className="px-7 py-7 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Follow-ups</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">
          Click any follow-up to log a call for that student. Once a call is logged, it moves to "Completed".
        </p>
      </div>

      <FollowupsClient initialItems={items} />
    </div>
  );
}