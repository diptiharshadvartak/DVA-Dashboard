import { supabaseServer } from '@/lib/supabase/server';
import { KpiCard } from '@/components/ui/kpi-card';
import {
  CallsPerWeekChart, CollectionRateChart, ReminderDeliveryChart, StudentFunnelChart,
  type CallsPerWeekPoint, type CollectionRatePoint, type ReminderStatusSlice, type FunnelStage,
} from '@/components/reports/charts';
import { ReportsDateFilter } from './date-filter';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

const COLORS = {
  primary: '#6366f1',
  good:    '#10b981',
  warn:    '#f59e0b',
  risk:    '#ef4444',
};

function computeRange(params: { from?: string; to?: string; preset?: string }): { from: Date; to: Date; label: string } {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const preset = params.preset ?? '30d';

  if (params.from && params.to) {
    return {
      from: new Date(params.from + 'T00:00:00'),
      to: new Date(params.to + 'T23:59:59'),
      label: `${params.from} → ${params.to}`,
    };
  }

  switch (preset) {
    case '7d': { const from = new Date(now); from.setDate(from.getDate() - 7); return { from, to: endOfToday, label: 'Last 7 days' }; }
    case '30d': { const from = new Date(now); from.setDate(from.getDate() - 30); return { from, to: endOfToday, label: 'Last 30 days' }; }
    case '90d': { const from = new Date(now); from.setDate(from.getDate() - 90); return { from, to: endOfToday, label: 'Last 90 days' }; }
    case 'mtd': { const from = new Date(now.getFullYear(), now.getMonth(), 1); return { from, to: endOfToday, label: 'This month' }; }
    case 'last-month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { from, to, label: 'Last month' };
    }
    case 'ytd': { const from = new Date(now.getFullYear(), 0, 1); return { from, to: endOfToday, label: 'This year' }; }
    default: { const from = new Date(now); from.setDate(from.getDate() - 30); return { from, to: endOfToday, label: 'Last 30 days' }; }
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: { from?: string; to?: string; preset?: string } }) {
  await requirePermission('reports');
  const sb = supabaseServer();
  const now = new Date();
  const range = computeRange(searchParams ?? {});

  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const since12wIso = new Date(now.getTime() - 12 * 7 * 86400000).toISOString();
  const since6mIso  = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [
    { data: students },
    { data: callsTrend },
    { data: callsInRange },
    { data: emiTrend },
    { data: emiInRange },
    { data: remindersInRange }
  ] = await Promise.all([
    sb.from('students').select('id, end_date, deleted_at').is('deleted_at', null),
    sb.from('call_logs').select('created_at, student_id').gte('created_at', since12wIso),
    sb.from('call_logs').select('created_at, student_id').gte('created_at', fromIso).lte('created_at', toIso),
    sb.from('emi_schedule').select('amount, due_date, status, paid_date').gte('due_date', since6mIso),
    sb.from('emi_schedule').select('amount, due_date, status, paid_date').gte('due_date', fromIso.slice(0, 10)).lte('due_date', toIso.slice(0, 10)),
    sb.from('reminders').select('event_id, status').gte('created_at', fromIso).lte('created_at', toIso),
  ]);

  const studentCount = students?.length ?? 0;
  const callsInRangeCount = (callsInRange ?? []).length;
  const callsPerStudent = studentCount > 0 ? (callsInRangeCount / studentCount).toFixed(1) : '0.0';

  const reminderTotal = (remindersInRange ?? []).length;
  const reminderDelivered = (remindersInRange ?? []).filter((r: any) => r.status === 'sent' || r.status === 'delivered').length;
  const deliveryPct = reminderTotal > 0 ? ((reminderDelivered / reminderTotal) * 100).toFixed(1) : '0.0';

  const rangeDue = (emiInRange ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0);
  const rangePaid = (emiInRange ?? []).filter((e: any) => e.status === 'paid').reduce((s: number, e: any) => s + Number(e.amount), 0);
  const collectionPct = rangeDue > 0 ? ((rangePaid / rangeDue) * 100).toFixed(1) : '0.0';

  const callsPerWeek      = buildCallsPerWeek(callsTrend ?? [], now);
  const collectionByMonth = buildCollectionByMonth(emiTrend ?? [], now);
  const reminderPie       = buildReminderPie(remindersInRange ?? []);
  const studentFunnel     = buildStudentFunnel(students ?? [], now);

  return (
    <div className="px-7 py-7 max-w-[1400px]">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Reports</h1>
          <p className="text-[13.5px] text-ink-500 mt-1">Coverage, conversion, and collection at a glance.</p>
        </div>
        <ReportsDateFilter
          currentPreset={searchParams?.preset ?? (searchParams?.from && searchParams?.to ? 'custom' : '30d')}
          currentFrom={searchParams?.from}
          currentTo={searchParams?.to}
          label={range.label}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="Calls per student"
          value={callsPerStudent}
          sub={`${callsInRangeCount} calls · ${studentCount} students · ${range.label.toLowerCase()}`}
          tone={Number(callsPerStudent) >= 1 ? 'good' : 'warn'}
          icon="Phone"
        />
        <KpiCard
          label="Reminder delivery rate"
          value={`${deliveryPct}%`}
          sub={`${reminderDelivered}/${reminderTotal} · ${range.label.toLowerCase()}`}
          tone={Number(deliveryPct) >= 95 ? 'good' : 'warn'}
          icon="Send"
        />
        <KpiCard
          label="Collection vs due"
          value={`${collectionPct}%`}
          sub={`₹${Math.round(rangePaid).toLocaleString('en-IN')} of ₹${Math.round(rangeDue).toLocaleString('en-IN')} · ${range.label.toLowerCase()}`}
          tone={Number(collectionPct) >= 80 ? 'good' : 'warn'}
          icon="IndianRupee"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Calls logged per week" subtitle="last 12 weeks (trend)">
          <CallsPerWeekChart data={callsPerWeek} />
        </ChartCard>
        <ChartCard title="Monthly collection" subtitle="last 6 months · ₹ due vs paid (trend)">
          <CollectionRateChart data={collectionByMonth} />
        </ChartCard>
        <ChartCard title="Reminder status breakdown" subtitle={range.label.toLowerCase()}>
          <ReminderDeliveryChart data={reminderPie} />
        </ChartCard>
        <ChartCard title="Student funnel" subtitle="current snapshot">
          <StudentFunnelChart data={studentFunnel} />
        </ChartCard>
      </div>
    </div>
  );
}

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
    const next = new Date(wk); next.setDate(next.getDate() + 7);
    const inWeek = callsRaw.filter((c: any) => { const t = new Date(c.created_at).getTime(); return t >= wk.getTime() && t < next.getTime(); });
    return {
      weekLabel: wk.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      calls: inWeek.length,
      students: new Set(inWeek.map((c: any) => c.student_id)).size,
    };
  });
}

function buildCollectionByMonth(emiRaw: any[], now: Date): CollectionRatePoint[] {
  const months: Date[] = [];
  for (let i = 5; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  return months.map((m) => {
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const inMonth = emiRaw.filter((e: any) => { const due = new Date(e.due_date); return due >= m && due < next; });
    const due = inMonth.reduce((s: number, e: any) => s + Number(e.amount), 0);
    const paid = inMonth.filter((e: any) => e.status === 'paid').reduce((s: number, e: any) => s + Number(e.amount), 0);
    return { monthLabel: m.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), due, paid, rate: due > 0 ? (paid / due) * 100 : 0 };
  });
}

function buildReminderPie(remindersRaw: any[]): ReminderStatusSlice[] {
  const counts = { delivered: 0, sent: 0, queued: 0, failed: 0 } as Record<string, number>;
  for (const r of remindersRaw) {
    const s = r.status as string;
    if (s === 'delivered') counts.delivered++;
    else if (s === 'sent') counts.sent++;
    else if (s === 'queued') counts.queued++;
    else if (s === 'failed') counts.failed++;
  }
  return [
    { name: 'Delivered', value: counts.delivered, color: COLORS.good    },
    { name: 'Sent',      value: counts.sent,      color: COLORS.primary },
    { name: 'Queued',    value: counts.queued,    color: COLORS.warn    },
    { name: 'Failed',    value: counts.failed,    color: COLORS.risk    },
  ].filter((s) => s.value > 0);
}

function buildStudentFunnel(studentsRaw: any[], now: Date): FunnelStage[] {
  let active = 0, expiring = 0, expired = 0;
  const in30d = now.getTime() + 30 * 86400000;
  for (const s of studentsRaw) {
    if (!s.end_date) { active++; continue; }
    const end = new Date(s.end_date).getTime();
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