'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

type Student = Database['public']['Tables']['students']['Row'];
type WeekKey = `week_${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24}`;

export function ProgressTab({
  student,
  onChange,
}: {
  student: Student;
  onChange?: (patch: Partial<Student>) => void;
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const weeks: WeekKey[] = Array.from({ length: 24 }, (_, i) => `week_${i + 1}` as WeekKey);
  const months: Array<'month_1' | 'month_2' | 'month_3' | 'month_4' | 'month_5' | 'month_6'> =
    ['month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'month_6'];

  const weeksCompleted = weeks.filter((w) => (student as any)[w]).length;
  const monthsCompleted = months.filter((m) => (student as any)[m]).length;
  const [busyWeek, setBusyWeek] = useState<WeekKey | null>(null);

  async function toggleWeek(w: WeekKey) {
    const next = !(student as any)[w];
    const weekNum = parseInt(w.replace('week_', ''));
    const monthNum = Math.ceil(weekNum / 4);
    const monthKey = `month_${monthNum}` as 'month_1';

    // Determine if month should be set to true/false:
    // After this toggle, check all 4 weeks of this month
    const monthWeeks = [1, 2, 3, 4].map((i) => `week_${(monthNum - 1) * 4 + i}` as WeekKey);
    const futureWeeksCompleted = monthWeeks.filter((mw) =>
      mw === w ? next : !!(student as any)[mw]
    ).length;
    const shouldMonthBeComplete = futureWeeksCompleted === 4;
    const currentMonthState = !!(student as any)[monthKey];

    // Optimistic update — both week and month
    const patch: any = { [w]: next };
    if (shouldMonthBeComplete !== currentMonthState) {
      patch[monthKey] = shouldMonthBeComplete;
    }
    onChange?.(patch);

    setBusyWeek(w);
    const { error } = await sb.from('students').update(patch as any).eq('id', student.id);
    setBusyWeek(null);

    if (error) {
      // Rollback
      const rollback: any = { [w]: !next };
      if (shouldMonthBeComplete !== currentMonthState) {
        rollback[monthKey] = currentMonthState;
      }
      onChange?.(rollback);
      toast(error.message, 'error');
      return;
    }

    let msg = `Week ${weekNum} ${next ? 'completed' : 'unmarked'}`;
    if (shouldMonthBeComplete && !currentMonthState) {
      msg = `Week ${weekNum} completed — Month ${monthNum} auto-completed!`;
    } else if (!shouldMonthBeComplete && currentMonthState) {
      msg = `Week ${weekNum} unmarked — Month ${monthNum} no longer complete`;
    }
    toast(msg, 'success');
  }

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="bg-white border border-ink-200/70 rounded-xl p-5">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-[12px] text-ink-500 font-medium">Months completed</div>
            <div className="text-[28px] font-semibold tracking-tight leading-none mt-1">
              {monthsCompleted} <span className="text-ink-400 font-normal text-[18px]">/ 6</span>
            </div>
            <div className="flex items-center gap-1 mt-2.5">
              {months.map((m) => (
                <div key={m} className={cn('flex-1 h-1.5 rounded-full transition-colors', (student as any)[m] ? 'bg-emerald-500' : 'bg-ink-200')} />
              ))}
            </div>
            <div className="text-[11px] text-ink-500 mt-2">Auto-completed when all 4 weeks of a month are done</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-500 font-medium">Weeks completed</div>
            <div className="text-[28px] font-semibold tracking-tight leading-none mt-1">
              {weeksCompleted} <span className="text-ink-400 font-normal text-[18px]">/ 24</span>
            </div>
            <div className="flex items-center gap-0.5 mt-2.5">
              {weeks.map((w) => (
                <div key={w} className={cn('flex-1 h-1.5 rounded-sm transition-colors', (student as any)[w] ? 'bg-accent-500' : 'bg-ink-200')} />
              ))}
            </div>
            <div className="text-[11px] text-ink-500 mt-2">{Math.round(weeksCompleted / 24 * 100)}% complete</div>
          </div>
        </div>
      </div>

      {/* Weekly checkpoints by month */}
      <div className="bg-white border border-ink-200/70 rounded-xl p-5">
        <h3 className="text-[14px] font-semibold mb-1">Weekly checkpoints</h3>
        <p className="text-[12px] text-ink-500 mb-4">Click any week to toggle. When all 4 weeks of a month are checked, that month auto-completes.</p>

        {[1, 2, 3, 4, 5, 6].map((monthNum) => {
          const monthWeeks = weeks.slice((monthNum - 1) * 4, monthNum * 4);
          const monthCompleted = monthWeeks.filter((w) => (student as any)[w]).length;
          const isMonthDone = monthCompleted === 4;
          return (
            <div key={monthNum} className="mb-5 last:mb-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-[12.5px] font-semibold text-ink-700">Month {monthNum}</h4>
                  {isMonthDone && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-2.5 h-2.5" />
                      complete
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-ink-500 font-medium">{monthCompleted}/4 weeks</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {monthWeeks.map((w) => {
                  const weekNum = parseInt(w.replace('week_', ''));
                  const isOn = !!(student as any)[w];
                  const isBusy = busyWeek === w;
                  return (
                    <button
                      key={w}
                      onClick={() => !isBusy && toggleWeek(w)}
                      disabled={isBusy}
                      className={cn(
                        'h-14 px-2 rounded-lg border text-center transition relative',
                        isOn
                          ? 'bg-accent-50/60 border-accent-300 hover:bg-accent-50'
                          : 'bg-white border-ink-200 hover:border-ink-300 hover:bg-ink-50',
                        isBusy && 'opacity-60'
                      )}
                    >
                      <div className={cn('text-[10px] uppercase tracking-wider font-medium mb-0.5', isOn ? 'text-accent-700' : 'text-ink-500')}>
                        Week
                      </div>
                      <div className={cn('text-[15px] font-bold leading-none', isOn ? 'text-accent-700' : 'text-ink-900')}>
                        {weekNum}
                      </div>
                      {isOn && !isBusy && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent-500 grid place-items-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </span>
                      )}
                      {isBusy && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-ink-300 grid place-items-center">
                          <Loader2 className="w-2.5 h-2.5 text-ink-500 animate-spin" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}