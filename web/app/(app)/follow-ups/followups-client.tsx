'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { StudentAvatar } from '@/components/ui/avatar';
import { fmtDate } from '@/lib/utils';
import { Phone, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type FollowUp = {
  id: string;
  student_id: string;
  comment: string;
  outcome: string | null;
  next_action: string;
  next_action_due: string;
  created_at: string;
  coach_initials: string | null;
  coach_name: string | null;
  student_first: string | null;
  student_last: string | null;
  student_email: string;
  student_mobile: string | null;
  is_completed: boolean;
  completed_at: string | null;
};

type Tab = 'pending' | 'overdue' | 'today' | 'completed';

export function FollowupsClient({ initialItems }: { initialItems: FollowUp[] }) {
  const [tab, setTab] = useState<Tab>('pending');
  const today = new Date().toISOString().slice(0, 10);

  // Split items into pending vs completed
  const pendingItems = useMemo(
    () => initialItems.filter((f) => !f.is_completed && f.next_action_due <= today),
    [initialItems, today]
  );
  const completedItems = useMemo(
    () => initialItems.filter((f) => f.is_completed),
    [initialItems]
  );
  const overdueItems = useMemo(
    () => pendingItems.filter((f) => f.next_action_due < today),
    [pendingItems, today]
  );
  const todayItems = useMemo(
    () => pendingItems.filter((f) => f.next_action_due === today),
    [pendingItems, today]
  );

  let filtered: FollowUp[] = [];
  if (tab === 'pending') filtered = pendingItems;
  else if (tab === 'overdue') filtered = overdueItems;
  else if (tab === 'today') filtered = todayItems;
  else if (tab === 'completed') filtered = completedItems;

  return (
    <>
      {/* Filter tabs */}
      <div className="bg-white border border-ink-200/70 rounded-xl mb-5 p-1.5 flex items-center gap-1 w-fit">
        <TabButton active={tab === 'pending'}   onClick={() => setTab('pending')}   label="All pending" count={pendingItems.length} />
        <TabButton active={tab === 'overdue'}   onClick={() => setTab('overdue')}   label="Overdue"     count={overdueItems.length}   tone="risk" />
        <TabButton active={tab === 'today'}     onClick={() => setTab('today')}     label="Today"       count={todayItems.length}     tone="warn" />
        <TabButton active={tab === 'completed'} onClick={() => setTab('completed')} label="Completed"   count={completedItems.length} tone="good" />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-ink-200/70 rounded-xl px-6 py-12 text-center">
          <Phone className="w-8 h-8 text-ink-300 mx-auto mb-3" />
          <div className="text-[14.5px] font-medium text-ink-800 mb-1">
            {tab === 'overdue' ? 'No overdue follow-ups' :
             tab === 'today' ? 'No follow-ups due today' :
             tab === 'completed' ? 'No completed follow-ups yet' :
             'No pending follow-ups'}
          </div>
          <div className="text-[12.5px] text-ink-500">
            {tab === 'completed'
              ? 'When you log a call after a follow-up was scheduled, it appears here.'
              : 'When you log a call with a "Next action" + due date, it shows up here on the due date.'}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-ink-200/70 rounded-xl overflow-hidden">
          {filtered.map((f, idx) => {
            const todayMs = Date.now();
            const daysDiff = Math.floor((new Date(f.next_action_due).getTime() - todayMs) / 86400000);
            const isOverdue = daysDiff < 0;
            let dueLabel = '';
            if (f.is_completed) dueLabel = 'Completed';
            else if (daysDiff < 0) dueLabel = `${Math.abs(daysDiff)}d overdue`;
            else if (daysDiff === 0) dueLabel = 'Due today';
            else dueLabel = `In ${daysDiff}d`;

            const isLast = idx === filtered.length - 1;

            return (
              <Link
                key={f.id}
                // CRITICAL: link to student WITH ?tab=calls so the slideover opens on the Calls tab
                href={`/students?student=${f.student_id}&tab=calls` as any}
                className={
                  'block px-5 py-4 hover:bg-ink-50/60 ' +
                  (isLast ? '' : 'border-b border-ink-100') +
                  (f.is_completed ? ' opacity-70' : '')
                }
              >
                <div className="flex items-start gap-3">
                  <StudentAvatar first={f.student_first} last={f.student_last} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <div className="font-semibold text-[13.5px] text-ink-900">
                        {f.student_first} {f.student_last}
                      </div>
                      <div className="text-[11px] text-ink-500">{f.student_mobile ?? f.student_email}</div>
                      {f.is_completed && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ml-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          completed
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-ink-700 mb-1.5">
                      <span className="font-medium">→</span> {f.next_action}
                    </div>
                    <div className="text-[11.5px] text-ink-500 line-clamp-1">
                      Promised on {fmtDate(f.created_at)}
                      {f.coach_name ? ` · ${f.coach_name}` : ''}
                      {f.outcome ? ` · ${f.outcome.replace(/_/g, ' ')}` : ''}
                      {f.is_completed && f.completed_at ? ` · call logged ${fmtDate(f.completed_at)}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={
                      'text-[12px] font-semibold ' +
                      (f.is_completed ? 'text-emerald-700' :
                       isOverdue ? 'text-rose-700' : 'text-amber-700')
                    }>{dueLabel}</div>
                    <div className="text-[11px] text-ink-500 mt-0.5">{fmtDate(f.next_action_due)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function TabButton({ active, onClick, label, count, tone }: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: 'risk' | 'warn' | 'good';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-8 px-3 rounded-md text-[12.5px] font-medium flex items-center gap-1.5 transition',
        active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100'
      )}
    >
      {label}
      {count > 0 && (
        <span className={cn(
          'text-[10.5px] font-semibold px-1.5 py-0.5 rounded',
          active ? 'bg-white/20 text-white' :
          tone === 'risk' ? 'bg-rose-100 text-rose-700' :
          tone === 'warn' ? 'bg-amber-100 text-amber-800' :
          tone === 'good' ? 'bg-emerald-100 text-emerald-700' :
          'bg-ink-100 text-ink-700'
        )}>{count}</span>
      )}
    </button>
  );
}