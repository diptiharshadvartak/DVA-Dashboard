import { supabaseServer } from '@/lib/supabase/server';
import { ReminderEventsTable } from '@/components/reminders/events-table';
import { RemindersActions } from '@/components/reminders/reminders-actions';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

export default async function RemindersPage() {
  
  await requirePermission('reminders');const sb = supabaseServer();
  const { data: events } = await sb.from('reminder_events').select('*').order('id');

  return (
    <div className="px-7 py-7 max-w-[1100px]">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Reminders & Automations</h1>
          <p className="text-[13.5px] text-ink-500 mt-1">Every event below maps to a GoHighLevel workflow you control. Toggle off, change schedule, or test-fire any event.</p>
        </div>
        <RemindersActions />
      </div>
      <ReminderEventsTable events={events ?? []} />
    </div>
  );
}