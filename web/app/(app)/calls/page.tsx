import { supabaseServer } from '@/lib/supabase/server';
import { QueueCard } from '@/components/calls/queue-card';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

export default async function CallsPage() {
  
  await requirePermission('calls');const sb = supabaseServer();
  const { data } = await sb.from('v_students_silent_30d').select('*').limit(8);

  return (
    <div className="px-7 py-7 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight">Call Queue</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">Your queue today — students who&apos;ve been silent or have follow-ups due.</p>
      </div>

      {(!data || data.length === 0) ? (
        <div className="bg-white border border-ink-200/70 rounded-xl p-12 text-center text-[13px] text-ink-500">
          🎉 No outstanding calls. Queue is clear.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(data as any[]).map((s: any) => (
            <QueueCard key={s.id} row={s} />
          ))}
        </div>
      )}
    </div>
  );
}