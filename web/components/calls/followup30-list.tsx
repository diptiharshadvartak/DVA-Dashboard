'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Phone, X } from 'lucide-react';
import { StudentAvatar } from '@/components/ui/avatar';

type Row = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  created_at: string;
};

// Local YYYY-MM-DD for an arbitrary date.
function ymd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// The 30-day follow-up date = the day a student joined + 30 days.
function followUpDate(created_at: string): Date {
  const d = new Date(created_at);
  d.setDate(d.getDate() + 30);
  return d;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function FollowUp30List({ rows }: { rows: Row[] }) {
  const today = ymd(new Date());
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const enriched = useMemo(
    () => rows.map((r) => ({ ...r, due: followUpDate(r.created_at) })),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      .filter((r) => {
        const dueYmd = ymd(r.due);
        if (from && dueYmd < from) return false;
        if (to && dueYmd > to) return false;
        if (q) {
          const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.toLowerCase();
          const phone = (r.mobile ?? '').toLowerCase();
          const email = (r.email ?? '').toLowerCase();
          if (!name.includes(q) && !phone.includes(q) && !email.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [enriched, query, from, to]);

  const rangeLabel =
    from === to ? (from === today ? 'today' : shortDate(new Date(from))) : `${from} → ${to}`;

  return (
    <div className="px-7 py-7 max-w-[1100px]">
      <div className="mb-5">
        <h1 className="text-[24px] font-semibold tracking-tight">30 Day Follow-up</h1>
        <p className="text-[13.5px] text-ink-500 mt-1">
          Students whose 30-day check-in call is due. {filtered.length} due {rangeLabel}.
        </p>
      </div>

      {/* Toolbar: search + date range */}
      <div className="flex flex-wrap items-end gap-2.5 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-ink-200 bg-white text-[13px] focus:outline-none focus:border-accent-500"
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-ink-600">Start date</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-ink-200 bg-white text-[13px] focus:outline-none focus:border-accent-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-ink-600">End date</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 px-2.5 rounded-lg border border-ink-200 bg-white text-[13px] focus:outline-none focus:border-accent-500"
          />
        </label>
        {(query || from !== today || to !== today) && (
          <button
            onClick={() => { setQuery(''); setFrom(today); setTo(today); }}
            className="h-9 self-end px-3 rounded-lg border border-ink-200 bg-white hover:bg-ink-50 text-[12.5px] font-medium inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-ink-200/70 rounded-xl p-12 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="text-[14.5px] font-medium text-ink-800 mb-1">No follow-ups in this range</div>
          <div className="text-[12.5px] text-ink-500">Adjust the date range or search to see more.</div>
        </div>
      ) : (
        <div className="bg-white border border-ink-200/70 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_160px_140px_110px] gap-3 px-5 py-2.5 border-b border-ink-200/70 text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
            <div>Student</div>
            <div>Phone</div>
            <div>30-day on</div>
            <div className="text-right">Action</div>
          </div>
          {filtered.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1fr_160px_140px_110px] gap-3 px-5 py-3 items-center border-b border-ink-100 last:border-0 hover:bg-ink-50/50 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <StudentAvatar first={r.first_name} last={r.last_name} size={34} />
                <div className="min-w-0">
                  <div className="font-medium text-[13.5px] truncate">{r.first_name} {r.last_name}</div>
                  <div className="text-[11.5px] text-ink-500 truncate">{r.email}</div>
                </div>
              </div>
              <div className="text-[12.5px] text-ink-700">{r.mobile ?? '—'}</div>
              <div className="text-[12.5px] text-ink-700">{shortDate(r.due)}</div>
              <div className="text-right">
                <Link
                  href={`/students?student=${r.id}&tab=calls` as any}
                  className="btn-primary h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" /> Log call
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
