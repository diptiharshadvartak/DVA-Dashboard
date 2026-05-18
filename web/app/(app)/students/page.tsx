import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { KpiCard } from '@/components/ui/kpi-card';
import { StudentsTable } from '@/components/students/students-table';
import { StudentsActions } from '@/components/students/students-actions';
import { getMyPermissions } from '@/lib/check-permission';

export const dynamic = 'force-dynamic';

type Filter = 'all' | 'active' | 'expiring' | 'expired';

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

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default async function StudentsPage({ searchParams }: { searchParams: { filter?: string } }) {
  const sb = supabaseServer();
  const activeFilter = (searchParams?.filter ?? 'all') as Filter;
  const { has } = await getMyPermissions();
  const canSeeEmi = has('emi');

  const promises: any[] = [
    sb.from('students').select('*', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false }).limit(2000),
  ];
  if (canSeeEmi) {
    promises.push(
      sb.from('emi_schedule').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
      sb.from('emi_schedule').select('amount').eq('status', 'overdue'),
    );
  }

  const results = await Promise.all(promises);
  const { data: students, count } = results[0];
  const overdueCount = canSeeEmi ? (results[1]?.count ?? 0) : 0;
  const dueAmount = canSeeEmi ? (results[2]?.data ?? []) : [];

  const studentIds = (students ?? []).map((s: any) => s.id);
  const lastCallByStudent: Record<string, string> = {};
  const lastPaymentByStudent: Record<string, { mode: string; date: string }> = {};

  if (studentIds.length > 0) {
    const { data: calls } = await sb
      .from('call_logs')
      .select('student_id, created_at')
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });
    for (const c of (calls ?? []) as any[]) {
      if (!lastCallByStudent[c.student_id]) {
        lastCallByStudent[c.student_id] = relativeTime(c.created_at);
      }
    }

    const { data: pays } = await sb
      .from('emi_schedule')
      .select('student_id, paid_date, paid_via')
      .in('student_id', studentIds)
      .eq('status', 'paid')
      .order('paid_date', { ascending: false });
    for (const p of (pays ?? []) as any[]) {
      if (!lastPaymentByStudent[p.student_id] && p.paid_date) {
        lastPaymentByStudent[p.student_id] = {
          mode: p.paid_via ?? 'paid',
          date: shortDate(p.paid_date),
        };
      }
    }
  }

  const total = count ?? 0;
  const now = Date.now();
  const activeCount = (students ?? []).filter((s: any) => {
    if (!s.end_date) return true;
    return new Date(s.end_date).getTime() >= now;
  }).length ?? 0;
  const expiringCount = (students ?? []).filter((s: any) => {
    if (!s.end_date) return false;
    const days = Math.ceil((new Date(s.end_date).getTime() - now) / 86400000);
    return days >= 0 && days <= 30;
  }).length ?? 0;
  const totalOverdue = (dueAmount as any[]).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="px-7 py-7 max-w-[1400px]">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight leading-tight">Students</h1>
          <p className="text-[13.5px] text-ink-500 mt-1">Manage active and historical Diamond students.</p>
        </div>
        <StudentsActions />
      </div>

      <div className={canSeeEmi ? "grid grid-cols-4 gap-3 mb-6" : "grid grid-cols-3 gap-3 mb-6"}>
        <Link href={'/students?filter=all' as any}      className="kpi-link" data-active={activeFilter === 'all'}>
          <KpiCard label="Total students" value={String(total)} sub="all-time" icon="Users" />
        </Link>
        <Link href={'/students?filter=active' as any}   className="kpi-link" data-active={activeFilter === 'active'}>
          <KpiCard label="Active" value={String(activeCount)} sub="currently enrolled" tone="good" icon="CircleCheck" />
        </Link>
        <Link href={'/students?filter=expiring' as any} className="kpi-link" data-active={activeFilter === 'expiring'}>
          <KpiCard label="Expiring · 30 d" value={String(expiringCount)} sub="renew window" tone="warn" icon="Clock" />
        </Link>
        {canSeeEmi && (
          <Link href={'/emi?tab=overdue' as any} className="kpi-link">
            <KpiCard label="EMI overdue" value={String(overdueCount ?? 0)} sub={'₹' + Math.round(totalOverdue).toLocaleString('en-IN') + ' due'} tone="risk" icon="TriangleAlert" />
          </Link>
        )}
      </div>

      <StudentsTable
        initialStudents={students ?? []}
        totalCount={total}
        initialFilter={activeFilter}
        lastCallByStudent={lastCallByStudent}
        lastPaymentByStudent={lastPaymentByStudent}
      />
    </div>
  );
}