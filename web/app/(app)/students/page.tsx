import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { KpiCard } from '@/components/ui/kpi-card';
import { StudentsTable } from '@/components/students/students-table';
import { StudentsActions } from '@/components/students/students-actions';
import { selectAllRows } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Filter = 'all' | 'active' | 'expiring' | 'expired';

// Convert a timestamp to a short relative string like "3 d ago", "today", "yesterday".
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Format a date string to "12 May" (short).
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Supabase/PostgREST returns at most ~1000 rows per request, so any unbounded
// list (the roster, the aggregates view, the overdue rows) must be read page by
// page. selectAllRows walks .range() until a short page signals the end (and
// fetches those pages in parallel), so the roster scales to N students — 3000,
// 25000, whatever — with no hard ceiling.
const fetchAll = selectAllRows;

export default async function StudentsPage({ searchParams }: { searchParams: { filter?: string } }) {
  const sb = supabaseServer();
  const activeFilter = (searchParams?.filter ?? 'all') as Filter;

  // Fetch the ENTIRE roster — no ceiling. The table paginates client-side via
  // PAGE_SIZE in students-table.tsx (10 at a time) but does its filtering,
  // search and KPI maths over the full array, so it needs every row. fetchAll
  // pages past the ~1000-row request cap, so this scales to any N students.
  //
  // The per-student "last call / last payment / EMI counts" used to be computed
  // with ~25 batched round-trips over call_logs + emi_schedule. They now come
  // from a single view (v_student_list_aggregates) that does the same
  // aggregation in one query — see the migration of the same name. It, too, is
  // paged so students beyond the first 1000 keep their aggregates.
  const [students, { count }, { count: overdueCount }, dueAmount, aggRows] = await Promise.all([
    fetchAll((f, t) => sb.from('students').select('*').is('deleted_at', null).order('created_at', { ascending: false }).range(f, t)),
    sb.from('students').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('emi_schedule').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
    fetchAll((f, t) => sb.from('emi_schedule').select('amount').eq('status', 'overdue').range(f, t)),
    fetchAll((f, t) => sb.from('v_student_list_aggregates' as any).select('*').range(f, t)),
  ]);

  // Pre-format date strings server-side so the table cells stay short and
  // don't overflow into the next column.
  const lastCallByStudent: Record<string, string> = {};
  const lastPaymentByStudent: Record<string, { mode: string; date: string }> = {};
  // EMI status map per student (counts by status — used for client-side EMI filter)
  const emiStatusByStudent: Record<string, { paid: number; total: number; overdue: number; upcoming: number }> = {};

  for (const r of (aggRows ?? []) as any[]) {
    if (r.last_call_at) {
      lastCallByStudent[r.student_id] = relativeTime(r.last_call_at);
    }
    if (r.last_paid_date && r.last_payment_mode) {
      lastPaymentByStudent[r.student_id] = {
        mode: r.last_payment_mode,
        date: shortDate(r.last_paid_date),
      };
    }
    // Only record students that actually have EMI rows — matches the previous
    // lazy-creation behaviour the client-side EMI filter relies on.
    if ((r.emi_total ?? 0) > 0) {
      emiStatusByStudent[r.student_id] = {
        paid: r.emi_paid ?? 0,
        total: r.emi_total ?? 0,
        overdue: r.emi_overdue ?? 0,
        upcoming: r.emi_upcoming ?? 0,
      };
    }
  }

  const total = count ?? 0;
  const now = Date.now();
  // Use course_end_date (what the table/filters use), falling back to end_date,
  // so these KPI counts match the list the cards link to.
  const endOf = (s: any) => s.course_end_date ?? s.end_date;
  const activeCount   = students?.filter((s: any) => !endOf(s) || new Date(endOf(s)).getTime() > now).length ?? 0;
  const expiringCount = students?.filter((s: any) => {
    if (!endOf(s)) return false;
    const days = Math.ceil((new Date(endOf(s)).getTime() - now) / 86400000);
    return days >= 0 && days <= 30;
  }).length ?? 0;
  const totalOverdue = ((dueAmount ?? []) as any[]).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="px-7 py-7 max-w-[1400px]">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Students</h1>
          <p className="text-[13.5px] text-ink-500 mt-1">Manage active and historical Diamond students.</p>
        </div>
        <StudentsActions />
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Link href={'/students?filter=all' as any}      className="kpi-link" data-active={activeFilter === 'all'}>
          <KpiCard label="Total students" value={String(total)} sub="all-time" icon="Users" />
        </Link>
        <Link href={'/students?filter=active' as any}   className="kpi-link" data-active={activeFilter === 'active'}>
          <KpiCard label="Active" value={String(activeCount)} sub="currently enrolled" tone="good" icon="CircleCheck" />
        </Link>
        <Link href={'/students?filter=expiring' as any} className="kpi-link" data-active={activeFilter === 'expiring'}>
          <KpiCard label="Expiring · 30 d" value={String(expiringCount)} sub="renew window" tone="warn" icon="Clock" />
        </Link>
        <Link href={'/emi?tab=overdue' as any}          className="kpi-link">
          <KpiCard label="EMI overdue" value={String(overdueCount ?? 0)} sub={'₹' + Math.round(totalOverdue).toLocaleString('en-IN') + ' due'} tone="risk" icon="TriangleAlert" />
        </Link>
      </div>

      <StudentsTable
        initialStudents={students ?? []}
        totalCount={total}
        initialFilter={activeFilter}
        lastCallByStudent={lastCallByStudent}
        lastPaymentByStudent={lastPaymentByStudent}
        emiStatusByStudent={emiStatusByStudent}
      />
    </div>
  );
}