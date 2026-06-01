import { supabaseServer } from '@/lib/supabase/server';
import { selectAllRows } from '@/lib/utils';
import { KpiCard } from '@/components/ui/kpi-card';
import {
  CallsPerWeekChart, CollectionRateChart, ReminderDeliveryChart, StudentFunnelChart,
  CompletionDistributionChart, PerMonthCompletionChart,
  AchievementsOverviewChart, CertificateStatusChart,
  type CallsPerWeekPoint, type CollectionRatePoint, type ReminderStatusSlice, type FunnelStage,
  type CompletionDistributionPoint, type PerMonthCompletionPoint,
  type AchievementPoint, type CertStatusSlice,
} from '@/components/reports/charts';

export const dynamic = 'force-dynamic';

// Color palette duplicated from charts.tsx so this server component doesn't
// need to import constants from a 'use client' file (Next.js RSC restriction).
const COLORS = {
  primary: '#6366f1',
  good:    '#10b981',
  warn:    '#f59e0b',
  risk:    '#ef4444',
};

export default async function ReportsPage() {
  const sb = supabaseServer();
  const now = new Date();

  const since12wIso = new Date(now.getTime() - 12 * 7 * 86400000).toISOString();
  const since6mIso  = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
  const since30dIso = new Date(now.getTime() - 30 * 86400000).toISOString();

  // All five reads are paginated (stable .order('id') + .range) so they don't
  // hit the PostgREST 1000-row cap and silently undercount the KPIs/charts.
  const [students, calls, emi, reminders, achievementStudents] = await Promise.all([
    selectAllRows((f, t) => sb.from('students').select('id, end_date, course_end_date, deleted_at').is('deleted_at', null).order('id').range(f, t)),
    selectAllRows((f, t) => sb.from('call_logs').select('created_at, student_id').gte('created_at', since12wIso).order('id').range(f, t)),
    selectAllRows((f, t) => sb.from('emi_schedule').select('amount, due_date, status, paid_date').gte('due_date', since6mIso).order('id').range(f, t)),
    selectAllRows((f, t) => sb.from('reminders').select('event_id, status').gte('created_at', since30dIso).order('id').range(f, t)),
    selectAllRows((f, t) => sb.from('students').select('id, month_1, month_2, month_3, month_4, month_5, month_6, is_super_baker_finisher, is_super_baker_pending, is_hall_of_fame, is_hall_of_fame_pending, certificate_issued, certificate_pending_manual, bbr_attended, bbr_pending, deleted_at').is('deleted_at', null).order('id').range(f, t)),
  ]);
  
  // ---------- Achievement metrics ----------
  const achievementList = (achievementStudents ?? []) as any[];
  
  const superBakerCount         = achievementList.filter(s => s.is_super_baker_finisher).length;
  const superBakerPendingCount  = achievementList.filter(s => s.is_super_baker_pending && !s.is_super_baker_finisher).length;
  const hallOfFameCount         = achievementList.filter(s => s.is_hall_of_fame).length;
  const hallOfFamePendingCount  = achievementList.filter(s => s.is_hall_of_fame_pending && !s.is_hall_of_fame).length;
  const sixMonthCount           = achievementList.filter(s => 
    s.month_1 && s.month_2 && s.month_3 && s.month_4 && s.month_5 && s.month_6
  ).length;
  const certIssuedCount         = achievementList.filter(s => s.certificate_issued).length;
  // Cert pending: either manually marked OR auto-derived (6 months done + not issued)
  const certPendingCount        = achievementList.filter(s => 
    !s.certificate_issued && (
      s.certificate_pending_manual || 
      (s.month_1 && s.month_2 && s.month_3 && s.month_4 && s.month_5 && s.month_6)
    )
  ).length;
  const bbrAttendedCount        = achievementList.filter(s => s.bbr_attended).length;
  const bbrPendingCount         = achievementList.filter(s => s.bbr_pending && !s.bbr_attended).length;
  
  // ---------- Average completion data ----------
  const totalMonthsAcrossAll = achievementList.reduce((sum, s) => 
    sum + [s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].filter(Boolean).length, 0
  );
  const avgCompletion = achievementList.length > 0 
    ? (totalMonthsAcrossAll / (achievementList.length * 6) * 100).toFixed(1)
    : '0.0';
  
  // Distribution: how many students at each completion level (0/6, 1/6, ..., 6/6)
  const completionDistribution: { months: string; students: number }[] = [];
  for (let i = 0; i <= 6; i++) {
    const count = achievementList.filter(s => 
      [s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].filter(Boolean).length === i
    ).length;
    completionDistribution.push({ months: `${i}/6`, students: count });
  }
  
  // Per-month completion percentage
  const perMonthCompletion = [1,2,3,4,5,6].map(m => ({
    month: `Month ${m}`,
    completed: achievementList.filter(s => s[`month_${m}`]).length,
    pct: achievementList.length > 0 
      ? Math.round(achievementList.filter(s => s[`month_${m}`]).length / achievementList.length * 100)
      : 0,
  }));

  // Achievements overview data for chart
  const achievementsOverview: AchievementPoint[] = [
    { name: 'Super Baker',     count: superBakerCount,    fill: '#f59e0b' },  // amber
    { name: 'Hall of Fame',    count: hallOfFameCount,    fill: '#a855f7' },  // purple
    { name: '6 Month Done',    count: sixMonthCount,      fill: '#10b981' },  // emerald
    { name: 'Cert Issued',     count: certIssuedCount,    fill: '#3b82f6' },  // blue
    { name: 'Cert Pending',    count: certPendingCount,   fill: '#f97316' },  // orange
    { name: 'BBR Attended',    count: bbrAttendedCount,   fill: '#6366f1' },  // indigo
  ];

  // Certificate status pie data — slices must be mutually exclusive, so
  // "Not Eligible" is the residual after Issued + Pending (covers students
  // who haven't done 6 months and have neither cert flag set).
  const totalActive = achievementList.length;
  const certNotEligible = Math.max(0, totalActive - certIssuedCount - certPendingCount);
  const certStatusData: CertStatusSlice[] = [
    { name: 'Issued',        value: certIssuedCount,    fill: '#10b981' },
    { name: 'Pending',       value: certPendingCount,   fill: '#f97316' },
    { name: 'Not Eligible',  value: certNotEligible,    fill: '#cbd5e1' },
  ].filter(s => s.value > 0);  // only show non-zero slices

  // ---------- KPI calculations ----------
  const studentCount  = students?.length ?? 0;
  const callsLast30   = (calls ?? []).filter((c: any) =>
    new Date(c.created_at).getTime() > now.getTime() - 30 * 86400000
  );
  const callsPerStudent = studentCount > 0
    ? (callsLast30.length / studentCount).toFixed(1)
    : '0.0';

  const reminderTotal     = (reminders ?? []).length;
  const reminderDelivered = (reminders ?? []).filter((r: any) =>
    r.status === 'sent' || r.status === 'delivered'
  ).length;
  const deliveryPct = reminderTotal > 0
    ? ((reminderDelivered / reminderTotal) * 100).toFixed(1)
    : '0.0';

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const mtdEmis = (emi ?? []).filter((e: any) => {
    const due = new Date(e.due_date);
    return due >= monthStart && due < monthEnd;
  });
  const mtdDue  = mtdEmis.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const mtdPaid = mtdEmis.filter((e: any) => e.status === 'paid')
                          .reduce((s: number, e: any) => s + Number(e.amount), 0);
  const collectionPct = mtdDue > 0 ? ((mtdPaid / mtdDue) * 100).toFixed(1) : '0.0';

  // ---------- Chart data ----------
  const callsPerWeek      = buildCallsPerWeek(calls ?? [], now);
  const collectionByMonth = buildCollectionByMonth(emi ?? [], now);
  const reminderPie       = buildReminderPie(reminders ?? []);
  const studentFunnel     = buildStudentFunnel(students ?? [], now);

  return (
    <div className="px-7 py-7 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight">Reports</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">Coverage, conversion, and collection at a glance.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="Calls per student / month"
          value={callsPerStudent}
          sub={`${callsLast30.length} calls · ${studentCount} students (last 30 d)`}
          tone={Number(callsPerStudent) >= 4 ? 'good' : 'warn'}
          icon="Phone"
        />
        <KpiCard
          label="Reminder delivery rate"
          value={`${deliveryPct}%`}
          sub={`${reminderDelivered}/${reminderTotal} (last 30 d)`}
          tone={Number(deliveryPct) >= 95 ? 'good' : 'warn'}
          icon="Send"
        />
        <KpiCard
          label="Collection vs due"
          value={`${collectionPct}%`}
          sub={`₹${Math.round(mtdPaid).toLocaleString('en-IN')} of ₹${Math.round(mtdDue).toLocaleString('en-IN')} MTD`}
          tone={Number(collectionPct) >= 80 ? 'good' : 'warn'}
          icon="IndianRupee"
        />
      </div>

      {/* Diamond Achievements section */}
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-ink-900 mb-3 flex items-center gap-2">
          🏆 Diamond Achievements
        </h2>
        <div className="grid grid-cols-6 gap-3">
          <KpiCard
            label="Super Baker"
            value={superBakerCount.toString()}
            sub={superBakerPendingCount > 0 ? `Finishers · ${superBakerPendingCount} pending` : 'Finishers'}
            tone="good"
            icon="Trophy"
          />
          <KpiCard
            label="Hall of Fame"
            value={hallOfFameCount.toString()}
            sub={hallOfFamePendingCount > 0 ? `Achievers · ${hallOfFamePendingCount} pending` : 'Achievers'}
            tone="good"
            icon="Award"
          />
          <KpiCard
            label="6 Month Challenge"
            value={sixMonthCount.toString()}
            sub="Completed"
            tone="good"
            icon="Calendar"
          />
          <KpiCard
            label="Certificates"
            value={certIssuedCount.toString()}
            sub="Issued"
            tone="good"
            icon="FileText"
          />
          <KpiCard
            label="Cert Pending"
            value={certPendingCount.toString()}
            sub="6 mo done, no cert"
            tone={certPendingCount > 0 ? 'warn' : 'good'}
            icon="Clock"
          />
          <KpiCard
            label="BBR Attended"
            value={bbrAttendedCount.toString()}
            sub={bbrPendingCount > 0 ? `Students · ${bbrPendingCount} pending` : 'Students'}
            tone="good"
            icon="GraduationCap"
          />
        </div>
      </div>
      
      {/* Completion progress section */}
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-ink-900 mb-3 flex items-center gap-2">
          📊 Average Completion
        </h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <KpiCard
            label="Average Completion"
            value={`${avgCompletion}%`}
            sub={`Across ${achievementList.length} active students`}
            tone={Number(avgCompletion) >= 50 ? 'good' : 'warn'}
            icon="BarChart"
          />
          <KpiCard
            label="Active Learners"
            value={achievementList.filter(s => 
              [s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].filter(Boolean).length > 0 &&
              [s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].filter(Boolean).length < 6
            ).length.toString()}
            sub="Mid-program"
            tone="good"
            icon="Users"
          />
          <KpiCard
            label="Not Started"
            value={achievementList.filter(s => 
              ![s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].some(Boolean)
            ).length.toString()}
            sub="No months marked"
            tone={achievementList.filter(s => ![s.month_1, s.month_2, s.month_3, s.month_4, s.month_5, s.month_6].some(Boolean)).length > 50 ? 'warn' : 'good'}
            icon="AlertCircle"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <ChartCard title="Completion distribution" subtitle="Students by months completed">
          <CompletionDistributionChart data={completionDistribution} />
        </ChartCard>
        <ChartCard title="Per-month completion rate" subtitle="% of active students at each milestone">
          <PerMonthCompletionChart data={perMonthCompletion} />
        </ChartCard>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <ChartCard title="Achievements overview" subtitle="Students achieving each milestone">
          <AchievementsOverviewChart data={achievementsOverview} />
        </ChartCard>
        <ChartCard title="Certificate status" subtitle="Issued vs Pending vs Not Eligible">
          <CertificateStatusChart data={certStatusData} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Calls logged per week" subtitle="last 12 weeks">
          <CallsPerWeekChart data={callsPerWeek} />
        </ChartCard>

        <ChartCard title="Monthly collection" subtitle="last 6 months · ₹ due vs paid">
          <CollectionRateChart data={collectionByMonth} />
        </ChartCard>

        <ChartCard title="Reminder status breakdown" subtitle="last 30 days">
          <ReminderDeliveryChart data={reminderPie} />
        </ChartCard>

        <ChartCard title="Student funnel" subtitle="current snapshot">
          <StudentFunnelChart data={studentFunnel} />
        </ChartCard>
      </div>
    </div>
  );
}

// ============================================================================
// Aggregation helpers
// ============================================================================

function lastNWeeks(n: number, anchor: Date): Date[] {
  const out: Date[] = [];
  const monday = new Date(anchor);
  const day = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(d.getDate() - i * 7);
    out.push(d);
  }
  return out;
}

function buildCallsPerWeek(callsRaw: any[], now: Date): CallsPerWeekPoint[] {
  const weeks = lastNWeeks(12, now);
  return weeks.map((wk) => {
    const next = new Date(wk);
    next.setDate(next.getDate() + 7);
    const inWeek = callsRaw.filter((c: any) => {
      const t = new Date(c.created_at).getTime();
      return t >= wk.getTime() && t < next.getTime();
    });
    const uniqueStudents = new Set(inWeek.map((c: any) => c.student_id)).size;
    return {
      weekLabel: wk.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      calls: inWeek.length,
      students: uniqueStudents,
    };
  });
}

function buildCollectionByMonth(emiRaw: any[], now: Date): CollectionRatePoint[] {
  const months: Date[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  return months.map((m) => {
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const inMonth = emiRaw.filter((e: any) => {
      const due = new Date(e.due_date);
      return due >= m && due < next;
    });
    const due  = inMonth.reduce((s: number, e: any) => s + Number(e.amount), 0);
    const paid = inMonth.filter((e: any) => e.status === 'paid')
                        .reduce((s: number, e: any) => s + Number(e.amount), 0);
    return {
      monthLabel: m.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      due, paid,
      rate: due > 0 ? (paid / due) * 100 : 0,
    };
  });
}

function buildReminderPie(remindersRaw: any[]): ReminderStatusSlice[] {
  const counts = { delivered: 0, sent: 0, queued: 0, failed: 0 } as Record<string, number>;

  for (const r of remindersRaw) {
    const status = r.status as string;
    if (status === 'delivered')      counts.delivered++;
    else if (status === 'sent')      counts.sent++;
    else if (status === 'queued')    counts.queued++;
    else if (status === 'failed')    counts.failed++;
  }

  const slices: ReminderStatusSlice[] = [
    { name: 'Delivered', value: counts.delivered, color: COLORS.good    },
    { name: 'Sent',      value: counts.sent,      color: COLORS.primary },
    { name: 'Queued',    value: counts.queued,    color: COLORS.warn    },
    { name: 'Failed',    value: counts.failed,    color: COLORS.risk    },
  ];
  return slices.filter((s) => s.value > 0);
}

function buildStudentFunnel(studentsRaw: any[], now: Date): FunnelStage[] {
  let active = 0, expiring = 0, expired = 0;
  const in30d = now.getTime() + 30 * 86400000;
  for (const s of studentsRaw) {
    // Course end lives in course_end_date for imported/edited students; fall
    // back to the legacy end_date so neither source is ignored.
    const endVal = s.course_end_date ?? s.end_date;
    if (!endVal) { active++; continue; }
    const end = new Date(endVal).getTime();
    if (end < now.getTime()) expired++;
    else if (end <= in30d) expiring++;
    else active++;
  }
  return [
    { stage: 'Active',   count: active,   color: COLORS.good },
    { stage: 'Expiring', count: expiring, color: COLORS.warn },
    { stage: 'Expired',  count: expired,  color: COLORS.risk },
  ];
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-5">
      <div className="mb-3">
        <div className="text-[14px] font-semibold text-ink-900">{title}</div>
        <div className="text-[11.5px] text-ink-500">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}