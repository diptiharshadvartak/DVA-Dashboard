import { supabaseServer } from '@/lib/supabase/server';
import { FollowupsClient } from './followups-client';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage() {
  
  await requirePermission('follow-ups');const sb = supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  // Only fetch follow-ups due TODAY or earlier (overdue).
  // Future follow-ups don't appear until their due date arrives.
  const { data: rows } = await sb
    .from('call_logs')
    .select(`
      id, student_id, comment, outcome, next_action, next_action_due, created_at,
      coach:profiles(display_name, initials),
      student:students(first_name, last_name, email, mobile)
    `)
    .not('next_action', 'is', null)
    .not('next_action_due', 'is', null)
    .lte('next_action_due', today)
    .order('next_action_due', { ascending: true });

  const items = ((rows ?? []) as any[]).map((r) => ({
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
  }));

  return (
    <div className="px-7 py-7 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Follow-ups</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">
          Students who need attention today or are overdue. Future follow-ups appear here on their due date.
        </p>
      </div>

      <FollowupsClient initialItems={items} />
    </div>
  );
}