import { supabaseServer } from '@/lib/supabase/server';
import { ProgressClient } from './progress-client';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

export default async function ProgressPage() {
  
  await requirePermission('progress');const sb = supabaseServer();

  const { data: students } = await sb
    .from('students')
    .select('id, first_name, last_name, email, start_date, end_date, month_1, month_2, month_3, month_4, month_5, month_6, membership')
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
    .limit(2000);

  const safe = (students ?? []) as any[];

  return (
    <div className="px-7 py-7 max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight leading-tight text-ink-900">Course Progress</h1>
        <p className="text-[13.5px] text-ink-500 mt-1.5">
          Students bucketed by joining date. Click any month to see who's stuck.
        </p>
      </div>

      <ProgressClient students={safe} />
    </div>
  );
}