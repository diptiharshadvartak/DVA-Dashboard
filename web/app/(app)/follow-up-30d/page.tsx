import { supabaseServer } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/check-permission';
import { selectAllRows } from '@/lib/utils';
import { FollowUp30List } from '@/components/calls/followup30-list';

export const dynamic = 'force-dynamic';

export default async function FollowUp30dPage() {
  await requirePermission('follow-up-30d');
  const sb = supabaseServer();

  // Load the whole active roster; the list computes each student's 30-day
  // follow-up date (created_at + 30d) and filters by date range + text search
  // client-side. selectAllRows pages past the ~1000-row request cap.
  const students = await selectAllRows((f, t) =>
    sb.from('students')
      .select('id, first_name, last_name, email, mobile, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(f, t)
  );

  return <FollowUp30List rows={students ?? []} />;
}
