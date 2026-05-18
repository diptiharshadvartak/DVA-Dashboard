import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmiTable } from '@/components/emi/emi-table';
import { EmiActions } from '@/components/emi/emi-actions';
import { requirePermission } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

type Tab = 'due' | 'overdue' | 'upcoming' | 'paid';

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfPrevMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() - 1, 1); }

export default async function EmiPage({ searchParams }: { searchParams: { tab?: string } }) {
  
  await requirePermission('emi');const sb = supabaseServer();
  const activeTab = (['due', 'overdue', 'upcoming', 'paid'].includes(searchParams?.tab ?? '')
    ? (searchParams!.tab as Tab)
    : 'due');

  const now = new Date();
  const thisMonth = startOfMonth(now).toISOString().slice(0, 10);
  const lastMonth = startOfPrevMonth(now).toISOString().slice(0, 10);

  // For tabs other than 'paid' we want non-paid rows.
  // For 'paid' tab we need to include paid rows too — fetch all open + recent paid.
  const [{ data: emi }, { data: paidThis }, { data: paidLast }] = await Promise.all([
    sb.from('emi_schedule')
      .select('*, students!inner(id, first_name, last_name, email, mobile, ghl_contact_id)')
      .order('due_date'),
    sb.from('emi_schedule').select('amount, paid_date').eq('status', 'paid').gte('paid_date', thisMonth),
    sb.from('emi_schedule').select('amount, paid_date').eq('status', 'paid').gte('paid_date', lastMonth).lt('paid_date', thisMonth),
  ]);

  const all = (emi ?? []) as any[];
  const due      = all.filter((e) => e.status === 'due_soon' || (e.status !== 'paid' && e.due_date && new Date(e.due_date) <= new Date(Date.now() + 7 * 86400000) && new Date(e.due_date) >= new Date()));
  const overdue  = all.filter((e) => e.status === 'overdue');
  const upcoming = all.filter((e) => e.status === 'upcoming');
  const dueAmount     = due.reduce((s, e) => s + Number(e.amount), 0);
  const overdueAmount = overdue.reduce((s, e) => s + Number(e.amount), 0);

  const collectedMtd  = ((paidThis ?? []) as any[]).reduce((s, r: any) => s + Number(r.amount ?? 0), 0);
  const collectedPrev = ((paidLast ?? []) as any[]).reduce((s, r: any) => s + Number(r.amount ?? 0), 0);
  const collectedSub = collectedPrev > 0
    ? `${collectedMtd >= collectedPrev ? '↑' : '↓'} ${Math.round(Math.abs((collectedMtd - collectedPrev) / collectedPrev) * 100)}% vs last month`
    : 'no prior month data';
  const collectedTone: 'good' | 'warn' = collectedMtd >= collectedPrev ? 'good' : 'warn';

  return (
    <div className="px-7 py-7 max-w-[1400px]">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">EMI Tracker</h1>
          <p className="text-[13.5px] text-ink-500 mt-1">Auto-scheduled reminders fire daily at 09:00 IST. Manual sends override the queue.</p>
        </div>
        <EmiActions />
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Link href={'/emi?tab=due' as any}      className="kpi-link" data-active={activeTab === 'due'}>
          <KpiCard label="Due this week" value={'₹' + Math.round(dueAmount).toLocaleString('en-IN')} sub={`${due.length} students`} tone="warn" icon="Clock" />
        </Link>
        <Link href={'/emi?tab=overdue' as any}  className="kpi-link" data-active={activeTab === 'overdue'}>
          <KpiCard label="Overdue" value={'₹' + Math.round(overdueAmount).toLocaleString('en-IN')} sub={`${overdue.length} students`} tone="risk" icon="TriangleAlert" />
        </Link>
        <Link href={'/emi?tab=upcoming' as any} className="kpi-link" data-active={activeTab === 'upcoming'}>
          <KpiCard label="Upcoming" value={String(upcoming.length)} sub="future installments" icon="List" />
        </Link>
        <Link href={'/emi?tab=paid' as any}     className="kpi-link" data-active={activeTab === 'paid'}>
          <KpiCard label="Collected MTD" value={'₹' + Math.round(collectedMtd).toLocaleString('en-IN')} sub={collectedSub} tone={collectedTone} icon="TrendingUp" />
        </Link>
      </div>

      <EmiTable rows={all as any} initialTab={activeTab} />
    </div>
  );
}