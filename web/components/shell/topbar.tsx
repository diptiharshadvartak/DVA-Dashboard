'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Moon, Sun, Search, Settings, LogOut, ChevronDown, TriangleAlert, Clock, UserX, CheckCircle2, CalendarClock, ArrowRight } from 'lucide-react';
import { cn, fmtINR, istDateString } from '@/lib/utils';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useTheme } from '@/components/shell/theme-provider';
import { useCommandPalette } from '@/components/shell/command-palette';

type SessionUser = {
  email: string;
  displayName: string;
  initials: string;
  role: 'coach' | 'admin';
} | null;

const PRESETS = ['av-AK', 'av-DV', 'av-FM', 'av-S'];
function avClassForInitials(initials: string): string {
  if (!initials) return 'bg-ink-900 text-white';
  const exact = `av-${initials.toUpperCase().slice(0, 2)}`;
  if (PRESETS.includes(exact)) return exact;
  const sum = initials.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PRESETS[sum % PRESETS.length];
}

type FollowupItem = {
  id: string;
  student_id: string;
  student_name: string;
  next_action: string;
};

type Notifs = {
  overdueCount: number;
  overdueAmount: number;
  followupsCount: number;
  followupItems: FollowupItem[];
  silentCount: number;
  expiringCount: number;
};

const EMPTY: Notifs = {
  overdueCount: 0, overdueAmount: 0, followupsCount: 0, followupItems: [],
  silentCount: 0, expiringCount: 0,
};

export function Topbar({ user }: { user: SessionUser }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const { theme, toggle } = useTheme();
  const { open: openPalette } = useCommandPalette();

  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notifs, setNotifs] = useState<Notifs>(EMPTY);
  const [loading, setLoading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    if (menuOpen || bellOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen, bellOpen]);

  async function refresh() {
    setLoading(true);
    const today = istDateString();
    try {
      const [overdueRows, followupsQuery, silentCount, expiringSoon] = await Promise.all([
        sb.from('emi_schedule').select('amount').eq('status', 'overdue'),
        // Include overdue follow-ups too (anything due today or before)
        sb.from('call_logs')
          .select('id, student_id, next_action, next_action_due, student:students(first_name, last_name)')
          .lte('next_action_due', today)
          .not('next_action', 'is', null)
          .order('next_action_due', { ascending: false })
          .limit(20),
        sb.from('v_students_silent_30d').select('id', { count: 'exact', head: true }),
        sb.from('students')
          .select('id', { count: 'exact', head: true })
          // Use course_end_date — the field the Students "Expiring" filter uses —
          // so this badge matches the list it links to.
          .gte('course_end_date', today)
          .lte('course_end_date', istDateString(new Date(Date.now() + 14 * 86400000)))
          .is('deleted_at', null),
      ]);
      const rows = (overdueRows.data ?? []) as any[];
      const followupRows = (followupsQuery.data ?? []) as any[];
      const followupItems: FollowupItem[] = followupRows.map((r: any) => ({
        id: r.id,
        student_id: r.student_id,
        student_name: r.student
          ? `${r.student.first_name ?? ''} ${r.student.last_name ?? ''}`.trim()
          : 'Unknown',
        next_action: r.next_action ?? '',
      }));

      setNotifs({
        overdueCount: rows.length,
        overdueAmount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
        followupsCount: followupItems.length,
        followupItems,
        silentCount: silentCount.count ?? 0,
        expiringCount: expiringSoon.count ?? 0,
      });
    } catch {
      /* keep previous state on failure */
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (bellOpen) refresh(); /* eslint-disable-next-line */ }, [bellOpen]);

  async function onSignOut() {
    setSigningOut(true);
    try { await sb.auth.signOut(); }
    finally { router.replace('/login'); router.refresh(); }
  }

  const avatarClass = avClassForInitials(user?.initials ?? '');
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  const totalUnread = notifs.overdueCount + notifs.followupsCount + notifs.silentCount + notifs.expiringCount;
  const hasUnread = totalUnread > 0;

  return (
    <header className="h-16 px-7 border-b border-ink-200/70 bg-white/80 backdrop-blur flex items-center gap-3">
      <button
        onClick={openPalette}
        className="flex-1 max-w-[520px] h-9 rounded-lg border border-ink-200 bg-ink-50/60 hover:bg-white hover:border-ink-300 transition flex items-center gap-2 px-3 text-[13px] text-ink-500"
      >
        <Search className="w-4 h-4" />
        <span>Search students, EMI, calls…</span>
        <span className="ml-auto flex items-center gap-1"><kbd>⌘</kbd><kbd>K</kbd></span>
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {/* Notifications bell */}
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setBellOpen((b) => !b)}
            className={cn('w-9 h-9 rounded-lg hover:bg-ink-100 grid place-items-center relative', bellOpen && 'bg-ink-100')}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-[18px] h-[18px] text-ink-700" />
            {hasUnread && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold grid place-items-center ring-2 ring-white">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-[380px] bg-white border border-ink-200/80 shadow-pop rounded-xl overflow-hidden z-50 max-h-[80vh] overflow-y-auto">
              <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between sticky top-0 bg-white">
                <div className="font-semibold text-[13.5px]">Notifications</div>
                <button onClick={refresh} className="text-[11px] text-ink-500 hover:text-ink-800" disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {totalUnread === 0 && !loading ? (
                <div className="px-4 py-8 text-center text-[12.5px] text-ink-500">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
                  All caught up — nothing pending.
                </div>
              ) : (
                <div className="divide-y divide-ink-100">
                  {/* FOLLOW-UPS — show inline with student names */}
                  {notifs.followupItems.length > 0 && (
                    <div>
                      <div className="px-4 pt-3 pb-2 flex items-center gap-2 bg-amber-50/50">
                        <CalendarClock className="w-3.5 h-3.5 text-amber-700" />
                        <div className="text-[11.5px] font-semibold uppercase tracking-wider text-amber-800">
                          Follow-ups due ({notifs.followupItems.length})
                        </div>
                      </div>
                      {notifs.followupItems.slice(0, 5).map((f) => (
                        <Link
                          key={f.id}
                          href={`/students?student=${f.student_id}` as any}
                          onClick={() => setBellOpen(false)}
                          className="flex items-start gap-3 px-4 py-2.5 hover:bg-amber-50/30 border-b border-ink-50 last:border-0"
                        >
                          <div className="w-7 h-7 rounded-full bg-amber-100 grid place-items-center shrink-0 text-[10px] font-semibold text-amber-800">
                            {f.student_name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium text-ink-900 truncate">{f.student_name}</div>
                            <div className="text-[11.5px] text-ink-600 line-clamp-2 leading-snug">→ {f.next_action}</div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-ink-400 mt-1 shrink-0" />
                        </Link>
                      ))}
                      {notifs.followupItems.length > 5 && (
                        <Link
                          href={'/follow-ups' as any}
                          onClick={() => setBellOpen(false)}
                          className="block px-4 py-2 text-[11.5px] text-accent-700 hover:bg-amber-50/30 font-medium text-center border-b border-ink-50"
                        >
                          See all {notifs.followupItems.length} follow-ups →
                        </Link>
                      )}
                    </div>
                  )}

                  {notifs.overdueCount > 0 && (
                    <NotifRow
                      href="/emi?tab=overdue"
                      icon={<TriangleAlert className="w-4 h-4 text-rose-600" />}
                      iconBg="bg-rose-50"
                      title={`${notifs.overdueCount} overdue EMI${notifs.overdueCount > 1 ? 's' : ''}`}
                      sub={fmtINR(notifs.overdueAmount) + ' to collect'}
                      onClick={() => setBellOpen(false)}
                    />
                  )}
                  {notifs.silentCount > 0 && (
                    <NotifRow
                      href="/calls"
                      icon={<UserX className="w-4 h-4 text-ink-600" />}
                      iconBg="bg-ink-100"
                      title={`${notifs.silentCount} silent student${notifs.silentCount > 1 ? 's' : ''}`}
                      sub="No call in 30+ days"
                      onClick={() => setBellOpen(false)}
                    />
                  )}
                  {notifs.expiringCount > 0 && (
                    <NotifRow
                      href="/students?filter=expiring"
                      icon={<Clock className="w-4 h-4 text-amber-700" />}
                      iconBg="bg-amber-50"
                      title={`${notifs.expiringCount} expiring soon`}
                      sub="Course ends within 14 days"
                      onClick={() => setBellOpen(false)}
                    />
                  )}
                </div>
              )}

              <div className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500 bg-ink-50/40 sticky bottom-0">
                Coach reminders are shown here · EMI WhatsApp goes via GHL
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          className="w-9 h-9 rounded-lg hover:bg-ink-100 grid place-items-center"
          aria-label="Toggle theme"
          onClick={toggle}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <ThemeIcon className="w-[18px] h-[18px] text-ink-700" />
        </button>

        <div className="w-px h-5 bg-ink-200 mx-2" />

        {/* Account menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((m) => !m)}
            className={cn(
              'flex items-center gap-1.5 pl-1 pr-1.5 h-9 rounded-full hover:bg-ink-100 transition',
              menuOpen && 'bg-ink-100'
            )}
            aria-label="Account menu"
          >
            <span className="relative inline-block">
              <span className={cn('w-7 h-7 rounded-full grid place-items-center text-[11px] font-semibold', avatarClass)}>
                {user?.initials ?? '?'}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </span>
            <ChevronDown className={cn('w-3.5 h-3.5 text-ink-500 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-[260px] bg-white border border-ink-200/80 shadow-pop rounded-xl overflow-hidden z-50">
              <div className="px-4 py-3.5 flex items-center gap-3 border-b border-ink-100">
                <span className={cn('w-10 h-10 rounded-full grid place-items-center text-[13px] font-semibold', avatarClass)}>
                  {user?.initials ?? '?'}
                </span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold leading-tight truncate">{user?.displayName ?? 'Guest'}</div>
                  <div className="text-[11.5px] text-ink-500 leading-tight truncate">{user?.email ?? ''}</div>
                </div>
              </div>
              <div className="p-1.5">
                <Link
                  href={'/settings' as any}
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] hover:bg-ink-50 text-left text-ink-700"
                >
                  <Settings className="w-4 h-4 text-ink-500" />
                  Account settings
                </Link>
              </div>
              <div className="border-t border-ink-100 p-1.5">
                <button
                  onClick={onSignOut}
                  disabled={signingOut}
                  className="w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] hover:bg-rose-50 text-left text-rose-700 disabled:opacity-60"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function NotifRow({
  href, icon, iconBg, title, sub, onClick,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <Link href={href as any} onClick={onClick} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
      <span className={cn('w-8 h-8 rounded-lg grid place-items-center shrink-0', iconBg)}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium truncate">{title}</div>
        <div className="text-[11.5px] text-ink-500 truncate">{sub}</div>
      </div>
    </Link>
  );
}