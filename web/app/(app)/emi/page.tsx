import { supabaseServer } from '@/lib/supabase/server';
import { KpiCard } from '@/components/ui/kpi-card';
import { FilterLink } from '@/components/ui/filter-link';
import { EmiTable } from '@/components/emi/emi-table';
import { EmiActions } from '@/components/emi/emi-actions';
import { requirePermission, getMyPermissions } from '@/lib/check-permission';
import { selectAllRows } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Tab = 'due' | 'overdue' | 'upcoming' | 'paid';

// Month boundary as a YYYY-MM-01 string from local year/month (m is 0-indexed
// and may be -1 or 12 to wrap a year). Built directly as a string to avoid the
// toISOString() UTC shift that moved the boundary to the previous day on
// non-UTC servers.
function monthStart(y: number, m: number): string {
  const yy = m < 0 ? y - 1 : m > 11 ? y + 1 : y;
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

export default async function EmiPage({ searchParams }: { searchParams: { tab?: string } }) {
  
  await requirePermission('emi');
  const { has } = await getMyPermissions();
  const canEditEmi = has('edit-students');
  // The Collected MTD revenue card is admin-only by default; admins can grant
  // the 'view-revenue' permission to a coach.
  const canViewRevenue = has('view-revenue');
  const sb = supabaseServer();
  const activeTab = (['due', 'overdue', 'upcoming', 'paid'].includes(searchParams?.tab ?? '')
    ? (searchParams!.tab as Tab)
    : 'due');

  // Use the IST calendar month for the "this month" window (the audience is in
  // India; a UTC month boundary would shift the window on a UTC server).
  const istNow = new Date(Date.now() + 5.5 * 3600_000);
  const y = istNow.getUTCFullYear(), mo = istNow.getUTCMonth();
  const thisMonth = monthStart(y, mo);
  const lastMonth = monthStart(y, mo - 1);
  const nextMonth = monthStart(y, mo + 1);

  // Collected this month / last month — each bounded to a single month window.
  // The "this month" query previously had NO upper bound, so future-dated paid
  // installments (common after an import) were summed into "Collected MTD" and
  // inflated it massively.
  const [{ data: paidThis }, { data: paidLast }] = await Promise.all([
    sb.from('emi_schedule').select('amount, paid_date').eq('status', 'paid').gte('paid_date', thisMonth).lt('paid_date', nextMonth),
    sb.from('emi_schedule').select('amount, paid_date').eq('status', 'paid').gte('paid_date', lastMonth).lt('paid_date', thisMonth),
  ]);

  // Fetch ALL emi rows. A single query is capped at 1000 rows by PostgREST, so
  // beyond that the later (future-dated) rows were silently dropped —
  // undercounting "Upcoming" and hiding rows from the table. selectAllRows pages
  // past the cap (and fetches those pages in parallel). The secondary sort on
  // the unique id makes the total order stable, so range-based pagination can't
  // skip or duplicate rows that share a due_date.
  const all: any[] = await selectAllRows((from, to) =>
    sb.from('emi_schedule')
      .select('*, students!inner(id, first_name, last_name, email, mobile, ghl_contact_id)')
      // Deleting a student now erases their installments outright, so this
      // filter is belt-and-braces — it only still hides rows left over from the
      // old deleted_at soft delete, which is how a deleted student's EMIs used
      // to keep showing up here. Nothing writes deleted_at any more.
      .is('students.deleted_at', null)
      .order('due_date').order('id').range(from, to),
  );
  // "Due this week" = flagged due_soon, OR an unpaid installment whose due date
  // falls in the next 7 days (status may still be 'upcoming' if the nightly cron
  // hasn't flipped it yet). Shared with the EmiTable's "Due this week" tab so the
  // card count and the list always agree.
  const isDueThisWeek = (e: any) =>
    e.status === 'due_soon' ||
    (e.status !== 'paid' && e.status !== 'cancelled' && e.due_date &&
      new Date(e.due_date) <= new Date(Date.now() + 7 * 86400000) &&
      new Date(e.due_date) >= new Date());
  const due      = all.filter(isDueThisWeek);
  const overdue  = all.filter((e) => e.status === 'overdue');
  // Exclude due-this-week rows so an item isn't counted in both cards.
  const upcoming = all.filter((e) => e.status === 'upcoming' && !isDueThisWeek(e));
  const dueAmount     = due.reduce((s, e) => s + Number(e.amount), 0);
  const overdueAmount = overdue.reduce((s, e) => s + Number(e.amount), 0);
  // Distinct students — the cards read "N students", but these are installment
  // lists (one student can have several overdue/due EMIs).
  const dueStudents     = new Set(due.map((e) => e.student_id)).size;
  const overdueStudents = new Set(overdue.map((e) => e.student_id)).size;

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
        <EmiActions canEdit={canEditEmi} />
      </div>

      <div className={`grid ${canViewRevenue ? 'grid-cols-4' : 'grid-cols-3'} gap-3 mb-6`}>
        <FilterLink param="tab" value="due" defaultValue="due" className="kpi-link">
          <KpiCard label="Due this week" value={'₹' + Math.round(dueAmount).toLocaleString('en-IN')} sub={`${dueStudents} student${dueStudents === 1 ? '' : 's'}`} tone="warn" icon="Clock" />
        </FilterLink>
        <FilterLink param="tab" value="overdue" defaultValue="due" className="kpi-link">
          <KpiCard label="Overdue" value={'₹' + Math.round(overdueAmount).toLocaleString('en-IN')} sub={`${overdueStudents} student${overdueStudents === 1 ? '' : 's'}`} tone="risk" icon="TriangleAlert" />
        </FilterLink>
        <FilterLink param="tab" value="upcoming" defaultValue="due" className="kpi-link">
          <KpiCard label="Upcoming" value={String(upcoming.length)} sub="future installments" icon="List" />
        </FilterLink>
        {canViewRevenue && (
          <FilterLink param="tab" value="paid" defaultValue="due" className="kpi-link">
            <KpiCard label="Collected MTD" value={'₹' + Math.round(collectedMtd).toLocaleString('en-IN')} sub={collectedSub} tone={collectedTone} icon="TrendingUp" />
          </FilterLink>
        )}
      </div>

      <EmiTable rows={all as any} initialTab={activeTab} />
    </div>
  );
}