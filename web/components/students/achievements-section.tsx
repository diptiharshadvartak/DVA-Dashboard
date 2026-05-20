'use client';

import { useState } from 'react';
import { Trophy, Award, Calendar, FileText, GraduationCap, Check, Clock, Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

type Student = Database['public']['Tables']['students']['Row'] & {
  is_super_baker_finisher?: boolean;
  is_super_baker_pending?: boolean;
  is_hall_of_fame?: boolean;
  is_hall_of_fame_pending?: boolean;
  certificate_issued?: boolean;
  certificate_issued_date?: string | null;
  certificate_pending_manual?: boolean;
  bbr_attended?: boolean;
  bbr_attended_date?: string | null;
  bbr_pending?: boolean;
};

type AchievementState = 'none' | 'pending' | 'achieved';

export function AchievementsSection({ 
  student, 
  onChange 
}: { 
  student: Student; 
  onChange?: (patch: Partial<Student>) => void;
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const monthsComplete = [
    student.month_1, student.month_2, student.month_3,
    student.month_4, student.month_5, student.month_6
  ].filter(Boolean).length;
  const sixMonthCompleted = monthsComplete === 6;

  function getState(achievedField: keyof Student, pendingField: keyof Student): AchievementState {
    if ((student as any)[achievedField]) return 'achieved';
    if ((student as any)[pendingField]) return 'pending';
    return 'none';
  }

  async function cycle(
    label: string,
    achievedField: keyof Student,
    pendingField: keyof Student,
    dateField?: keyof Student
  ) {
    const current = getState(achievedField, pendingField);
    let next: AchievementState;
    if (current === 'none') next = 'pending';
    else if (current === 'pending') next = 'achieved';
    else next = 'none';

    const updates: any = {};
    updates[achievedField] = next === 'achieved';
    updates[pendingField] = next === 'pending';
    if (dateField) {
      updates[dateField] = next === 'achieved' ? new Date().toISOString().slice(0, 10) : null;
    }

    setBusy(achievedField as string);
    onChange?.(updates);
    const { error } = await sb.from('students').update(updates).eq('id', student.id);
    setBusy(null);

    if (error) {
      const rollback: any = {};
      rollback[achievedField] = (student as any)[achievedField];
      rollback[pendingField] = (student as any)[pendingField];
      if (dateField) rollback[dateField] = (student as any)[dateField];
      onChange?.(rollback);
      toast(error.message, 'error');
      return;
    }
    toast(`${label}: ${next === 'none' ? 'cleared' : next === 'pending' ? 'marked pending' : 'marked achieved'}`, 'success');
  }

  async function cycleCert() {
    const isIssued = !!student.certificate_issued;
    const isManualPending = !!student.certificate_pending_manual;
    // Treat 6-months-done as already pending so the first click on an
    // auto-pending student advances straight to 'achieved' rather than
    // silently setting the manual flag with no visible change.
    const isPending = isManualPending || (sixMonthCompleted && !isIssued);

    let next: AchievementState;
    if (!isIssued && !isPending) next = 'pending';
    else if (isPending && !isIssued) next = 'achieved';
    else next = 'none';

    const updates: any = {
      certificate_issued: next === 'achieved',
      certificate_pending_manual: next === 'pending',
      certificate_issued_date: next === 'achieved' ? new Date().toISOString().slice(0, 10) : null,
    };

    const prev = {
      certificate_issued: student.certificate_issued,
      certificate_pending_manual: student.certificate_pending_manual,
      certificate_issued_date: student.certificate_issued_date,
    };

    setBusy('certificate');
    onChange?.(updates);
    const { error } = await sb.from('students').update(updates).eq('id', student.id);
    setBusy(null);
    if (error) {
      onChange?.(prev);
      toast(error.message, 'error');
      return;
    }
    toast(`Certificate: ${next === 'none' ? 'cleared' : next === 'pending' ? 'marked pending' : 'marked issued'}`, 'success');
  }

  const achievements = [
    {
      key: 'super_baker',
      label: 'Super Baker Finisher',
      icon: Trophy,
      iconColor: 'text-amber-500',
      state: getState('is_super_baker_finisher', 'is_super_baker_pending'),
      onClick: () => cycle('Super Baker', 'is_super_baker_finisher', 'is_super_baker_pending'),
      busyKey: 'is_super_baker_finisher',
    },
    {
      key: 'hof',
      label: 'Hall of Fame',
      icon: Award,
      iconColor: 'text-purple-500',
      state: getState('is_hall_of_fame', 'is_hall_of_fame_pending'),
      onClick: () => cycle('Hall of Fame', 'is_hall_of_fame', 'is_hall_of_fame_pending'),
      busyKey: 'is_hall_of_fame',
    },
    {
      key: 'six_month',
      label: '6 Month Challenge',
      icon: Calendar,
      iconColor: 'text-emerald-500',
      state: (sixMonthCompleted ? 'achieved' : monthsComplete > 0 ? 'pending' : 'none') as AchievementState,
      readonly: true,
      subtitle: `${monthsComplete}/6 months complete`,
    },
    {
      key: 'certificate',
      label: 'Certificate',
      icon: FileText,
      iconColor: 'text-blue-500',
      state: (
        student.certificate_issued ? 'achieved' :
        (student.certificate_pending_manual || (sixMonthCompleted && !student.certificate_issued)) ? 'pending' :
        'none'
      ) as AchievementState,
      onClick: cycleCert,
      busyKey: 'certificate',
      // Lock until all 6 months are done. Already-issued certs stay editable so
      // an accidentally-issued cert can still be cleared.
      readonly: !sixMonthCompleted && !student.certificate_issued,
      subtitle: student.certificate_issued
        ? (student.certificate_issued_date
            ? `Issued ${formatDate(student.certificate_issued_date)}`
            : 'Issued')
        : !sixMonthCompleted
          ? `Locked — complete 6 months first (${monthsComplete}/6)`
          : student.certificate_pending_manual
            ? 'Pending — marked manually'
            : 'Pending — 6 months done, awaiting issue',
    },
    {
      key: 'bbr',
      label: 'BBR Attended',
      icon: GraduationCap,
      iconColor: 'text-indigo-500',
      state: getState('bbr_attended', 'bbr_pending'),
      onClick: () => cycle('BBR', 'bbr_attended', 'bbr_pending', 'bbr_attended_date'),
      busyKey: 'bbr_attended',
      subtitle: student.bbr_attended && student.bbr_attended_date 
        ? `Attended ${formatDate(student.bbr_attended_date)}` 
        : undefined,
    },
  ];

  const totalAchieved = achievements.filter(a => a.state === 'achieved').length;
  const totalPending = achievements.filter(a => a.state === 'pending').length;

  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          Achievements
        </h3>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
            {totalAchieved} achieved
          </span>
          {totalPending > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold">
              {totalPending} pending
            </span>
          )}
        </div>
      </div>
      
      <div className="space-y-1.5">
        {achievements.map((a) => {
          const Icon = a.icon;
          const isBusy = busy === a.busyKey;
          const stateColors = getStateColors(a.state);
          return (
            <button
              key={a.key}
              onClick={(a as any).readonly ? undefined : (a as any).onClick}
              disabled={isBusy || (a as any).readonly}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all',
                stateColors.bg, stateColors.border,
                !(a as any).readonly && 'hover:border-ink-300 cursor-pointer',
                (a as any).readonly && 'cursor-default',
                isBusy && 'opacity-60'
              )}
            >
              <div className={cn(
                'w-9 h-9 rounded-md grid place-items-center flex-shrink-0',
                a.state !== 'none' ? 'bg-white' : 'bg-ink-100'
              )}>
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin text-ink-400" />
                ) : (
                  <Icon className={cn('w-4 h-4', a.state !== 'none' ? a.iconColor : 'text-ink-300')} />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className={cn(
                  'text-[13px] font-medium',
                  a.state !== 'none' ? 'text-ink-900' : 'text-ink-500'
                )}>
                  {a.label}
                </div>
                {(a as any).subtitle && (
                  <div className="text-[11px] mt-0.5 text-ink-500">
                    {(a as any).subtitle}
                  </div>
                )}
              </div>
              
              <div className="flex-shrink-0">
                <StateBadge state={a.state} />
              </div>
            </button>
          );
        })}
      </div>
      
      <p className="text-[11px] text-ink-500 mt-3 leading-relaxed">
        💡 Click any achievement to cycle: Not yet → Pending → Achieved → Clear
      </p>
    </div>
  );
}

function getStateColors(state: AchievementState) {
  if (state === 'achieved') return { bg: 'bg-emerald-50/60', border: 'border-emerald-200' };
  if (state === 'pending') return { bg: 'bg-orange-50/60', border: 'border-orange-200' };
  return { bg: 'bg-ink-50/50', border: 'border-ink-200/50' };
}

function StateBadge({ state }: { state: AchievementState }) {
  if (state === 'achieved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10.5px] font-semibold">
        <Check className="w-3 h-3" />
        Achieved
      </span>
    );
  }
  if (state === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10.5px] font-semibold">
        <Clock className="w-3 h-3" />
        Pending
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-ink-100 text-ink-500 text-[10.5px] font-medium">
      Not yet
    </span>
  );
}

function formatDate(d: string): string {
  try {
    const date = new Date(d);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}