'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, ChevronDown, Check, Phone, IndianRupee } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StudentAvatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtDateShort, daysFromNow, studentStatusFromEnd } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database';

type Row = Database['public']['Tables']['students']['Row'];
type StatusKey = 'active' | 'expiring' | 'expired';
type InitialFilter = 'all' | StatusKey;

const PAGE_SIZE = 10;
const TAG_DISPLAY_LIMIT = 3;

// Grid template — give Last call and Payment more breathing room so they
// don't overlap. Used in both header and body rows; must match.
const GRID_COLS = 'grid-cols-[36px_1.4fr_0.9fr_1fr_0.7fr_0.7fr_0.9fr_0.55fr]';

export function StudentsTable({
  initialStudents,
  totalCount,
  initialFilter = 'all',
  lastCallByStudent = {},
  lastPaymentByStudent = {},
  emiStatusByStudent = {},
}: {
  initialStudents: Row[];
  totalCount: number;
  initialFilter?: InitialFilter;
  lastCallByStudent?: Record<string, string>;
  lastPaymentByStudent?: Record<string, { mode: string; date: string }>;
  emiStatusByStudent?: Record<string, string>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [students, setStudents] = useState(initialStudents);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [memberships, setMemberships] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<StatusKey>>(
    initialFilter !== 'all' ? new Set([initialFilter]) : new Set()
  );
  const [tagSel, setTagSel] = useState<Set<string>>(new Set());
  const sb = useMemo(() => supabaseBrowser(), []);

  useEffect(() => { setStudents(initialStudents); }, [initialStudents]);

  useEffect(() => {
    setStatuses(initialFilter !== 'all' ? new Set([initialFilter]) : new Set());
  }, [initialFilter]);

  useEffect(() => {
    const ch = sb.channel('students-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => {
        router.refresh();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_logs' }, () => {
        router.refresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'emi_schedule' }, () => {
        router.refresh();
      })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, router]);

  const allMemberships = useMemo(() =>
    Array.from(new Set(students.map((s) => s.membership).filter(Boolean) as string[])).sort(),
    [students]);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [students]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (q) {
        const hit = s.first_name?.toLowerCase().includes(q)
          || s.last_name?.toLowerCase().includes(q)
          || s.email?.toLowerCase().includes(q)
          || s.mobile?.includes(q);
        if (!hit) return false;
      }
      if (memberships.size > 0 && !(s.membership && memberships.has(s.membership))) return false;
      if (statuses.size > 0 && !statuses.has(studentStatusFromEnd(s.end_date) as StatusKey)) return false;
      if (tagSel.size > 0 && !s.tags?.some((t) => tagSel.has(t))) return false;
      return true;
    });
  }, [students, query, memberships, statuses, tagSel]);

  useEffect(() => { setPage(1); }, [query, memberships, statuses, tagSel]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function openStudent(id: string) {
    const p = new URLSearchParams(params.toString());
    p.set('student', id);
    router.push(`?${p.toString()}` as any, { scroll: false });
  }

  const filterBanner =
    statuses.size === 1
      ? (statuses.has('active') ? 'Active students'
        : statuses.has('expiring') ? 'Expiring within 30 days'
        : 'Expired students')
      : null;

  function clearFilter() {
    setStatuses(new Set());
    router.push('/students' as any);
  }

  return (
    <div className="bg-white border border-ink-200/70 rounded-xl">
      <div className="px-5 py-3 flex items-center gap-2 border-b border-ink-100 flex-wrap">
        <div className="relative flex-1 max-w-[360px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-ink-400" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, mobile…"
            className="h-9 pl-9 pr-3 w-full text-[13px] bg-ink-50/60 hover:bg-white focus:bg-white border border-transparent hover:border-ink-200 focus:border-ink-300 rounded-lg outline-none transition"
          />
        </div>
        <FilterDropdown
          label="Membership"
          options={allMemberships.map((m) => ({ value: m, label: m }))}
          selected={memberships}
          onChange={setMemberships}
        />
        <FilterDropdown
          label="Tags"
          options={allTags.map((t) => ({ value: t, label: t }))}
          selected={tagSel}
          onChange={setTagSel}
        />
        <FilterDropdown<StatusKey>
          label="Status"
          options={[
            { value: 'active',   label: 'Active' },
            { value: 'expiring', label: 'Expiring soon' },
            { value: 'expired',  label: 'Expired' },
          ]}
          selected={statuses}
          onChange={setStatuses}
        />
        <div className="ml-auto text-[12px] text-ink-500">
          Showing <span className="font-medium text-ink-900">{filtered.length}</span> of {totalCount}
        </div>
      </div>

      {filterBanner && (
        <div className="px-5 py-2 bg-accent-50/30 border-b border-ink-100 flex items-center gap-2 text-[12.5px]">
          <span className="text-accent-700 font-medium">Filter:</span>
          <span className="text-ink-700">{filterBanner}</span>
          <button onClick={clearFilter} className="ml-auto text-ink-500 hover:text-ink-800 text-[12px]">
            Clear filter ✕
          </button>
        </div>
      )}

      <div className={cn('grid gap-3 px-6 py-2.5 text-[10.5px] uppercase tracking-wider text-ink-500 font-semibold border-b border-ink-100', GRID_COLS)}>
        <div />
        <div>Student</div>
        <div>Membership</div>
        <div>Tags</div>
        <div>End date</div>
        <div>Last call</div>
        <div>Payment</div>
        <div className="text-right">Status</div>
      </div>

      <div>
        {pageRows.map((s) => {
          const totalTags = s.tags?.length ?? 0;
          const visibleTags = (s.tags ?? []).slice(0, TAG_DISPLAY_LIMIT);
          const overflowCount = Math.max(0, totalTags - TAG_DISPLAY_LIMIT);
          const overflowTagsTitle = (s.tags ?? []).slice(TAG_DISPLAY_LIMIT).join(', ');
          const lastCall = lastCallByStudent[s.id];
          const lastPayment = lastPaymentByStudent[s.id];

          return (
            <button
              key={s.id}
              onClick={() => openStudent(s.id)}
              className={cn('row-clickable w-full text-left grid gap-3 px-6 py-3.5 items-center border-b border-ink-100 last:border-0', GRID_COLS)}
            >
              <StudentAvatar first={s.first_name} last={s.last_name} size={30} />
              <div className="min-w-0 overflow-hidden">
                <div className="font-medium text-[13.5px] truncate">{s.first_name} {s.last_name}</div>
                <div className="text-[11.5px] text-ink-500 truncate">{s.email}</div>
              </div>
              <div className="text-[13px] min-w-0 overflow-hidden">
                <div className="text-ink-900 font-medium truncate">{s.membership ?? '—'}</div>
                <div className="text-[11px] text-ink-500 truncate">{fmtDateShort(s.start_date)} – {fmtDateShort(s.end_date)}</div>
              </div>
              <div className="flex flex-wrap gap-1 items-center min-w-0 overflow-hidden">
                {totalTags === 0 && <span className="text-[11px] text-ink-400">—</span>}
                {visibleTags.map((t) => (
                  <span key={t} className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-ink-100 text-ink-700 whitespace-nowrap">{t}</span>
                ))}
                {overflowCount > 0 && (
                  <span
                    className="text-[10px] text-ink-500 px-1 cursor-help whitespace-nowrap"
                    title={overflowTagsTitle}
                  >
                    +{overflowCount}
                  </span>
                )}
              </div>
              <div className="text-[12.5px] min-w-0 overflow-hidden">
                <div className="font-medium truncate">{fmtDateShort(s.end_date)}</div>
                <div className="text-[10.5px] text-ink-500 truncate">{
                  (() => {
                    const d = daysFromNow(s.end_date);
                    if (d === null) return '—';
                    if (d < 0) return 'expired';
                    return `in ${d}d`;
                  })()
                }</div>
              </div>
              <div className="text-[12px] min-w-0 overflow-hidden">
                {lastCall ? (
                  <div className="flex items-center gap-1 text-ink-700 min-w-0">
                    <Phone className="w-3 h-3 text-ink-400 flex-shrink-0" />
                    <span className="truncate">{lastCall}</span>
                  </div>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </div>
              <div className="text-[12px] min-w-0 overflow-hidden">
                {lastPayment ? (
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-1 text-ink-900 font-medium min-w-0">
                      <IndianRupee className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                      <span className="truncate">{lastPayment.mode}</span>
                    </div>
                    <span className="text-[10.5px] text-ink-500 truncate pl-3.5">{lastPayment.date}</span>
                  </div>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </div>
              <div className="flex items-center justify-end min-w-0">
                <StatusPill status={studentStatusFromEnd(s.end_date)} />
              </div>
            </button>
          );
        })}
        {pageRows.length === 0 && (
          <div className="px-6 py-12 text-center text-[13px] text-ink-500">
            {filtered.length === 0 ? 'No students match your filters.' : 'No students on this page.'}
          </div>
        )}
      </div>

      <div className="px-6 py-3 flex items-center justify-between text-[12px] text-ink-500 border-t border-ink-100">
        <div>Page {safePage} of {pageCount}</div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="h-7 w-7 rounded-md border border-ink-200 grid place-items-center hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Previous page"
          ><ChevronLeft className="w-3.5 h-3.5" /></button>
          {pageNumbers(safePage, pageCount).map((n, i) => (
            n === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-ink-400">…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n as number)}
                className={cn(
                  'h-7 min-w-7 px-2 rounded-md border border-ink-200 grid place-items-center hover:bg-ink-50',
                  n === safePage && 'bg-ink-100 font-medium text-ink-900'
                )}
              >{n}</button>
            )
          ))}
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage === pageCount}
            className="h-7 w-7 rounded-md border border-ink-200 grid place-items-center hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Next page"
          ><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function pageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  if (current > 3) out.push('…');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) out.push(i);
  if (current < total - 2) out.push('…');
  out.push(total);
  return out;
}

function FilterDropdown<T extends string = string>({
  label, options, selected, onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function toggle(v: T) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  function clear() { onChange(new Set()); }

  const count = selected.size;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-9 px-3 rounded-lg border text-[12.5px] font-medium flex items-center gap-1.5 hover:bg-ink-50',
          count > 0 ? 'border-accent-500 text-accent-700 bg-accent-50' : 'border-ink-200 text-ink-700'
        )}
      >
        {label}
        {count > 0 && <span className="text-[11px] bg-accent-100 text-accent-700 rounded px-1.5">{count}</span>}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] w-[220px] bg-white border border-ink-200/80 shadow-pop rounded-lg overflow-hidden z-30">
          <div className="max-h-[260px] overflow-auto py-1">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-ink-500 text-center">No options</div>
            ) : (
              options.map((o) => {
                const active = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    className="w-full flex items-center gap-2 px-3 h-8 text-[13px] text-left hover:bg-ink-50"
                  >
                    <span className={cn('w-4 h-4 rounded border grid place-items-center', active ? 'bg-accent-600 border-accent-600 text-white' : 'border-ink-300')}>
                      {active && <Check className="w-3 h-3" />}
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {count > 0 && (
            <button onClick={clear} className="w-full text-center py-2 text-[12px] text-ink-600 hover:bg-ink-50 border-t border-ink-100">
              Clear ({count})
            </button>
          )}
        </div>
      )}
    </div>
  );
}