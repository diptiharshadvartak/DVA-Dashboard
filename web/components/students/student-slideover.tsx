'use client';
 
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, X, Mail, Phone, MessageSquarePlus, Send, CheckCheck } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StudentAvatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/status-pill';
import { studentStatusFromEnd, cn } from '@/lib/utils';
import { ProfileTab } from './profile-tab';
import { ProgressTab } from './progress-tab';
import { CallsTab } from './calls-tab';
import { PaymentsTab } from './payments-tab';
import { ProgressAiTab } from './progress-ai-tab';
import { TagEditor } from './tag-editor';
import { ReminderModal } from '@/components/reminders/reminder-modal';
import type { Database } from '@/types/database';
 
type Student = Database['public']['Tables']['students']['Row'];
type Tab = 'profile' | 'progress' | 'calls' | 'payments' | 'ai';
 
export function StudentSlideover() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('student');
  const initialTab = (params.get('tab') as Tab) || 'profile';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [student, setStudent] = useState<Student | null>(null);
  const [callsCount, setCallsCount] = useState(0);
  const [reminderOpen, setReminderOpen] = useState(false);
  const sb = useMemo(() => supabaseBrowser(), []);
 
  useEffect(() => {
    if (id) {
      setOpen(true);
      const tabFromUrl = (params.get('tab') as Tab) || 'profile';
      setTab(tabFromUrl);
    } else {
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, params]);
 
  useEffect(() => {
    if (!id) { setStudent(null); return; }
    let cancel = false;
    (async () => {
      const [{ data }, { count }] = await Promise.all([
        sb.from('students').select('*').eq('id', id).maybeSingle(),
        sb.from('call_logs').select('id', { count: 'exact', head: true }).eq('student_id', id),
      ]);
      if (!cancel) { setStudent(data as any); setCallsCount(count ?? 0); }
    })();
    return () => { cancel = true; };
  }, [id, sb]);
 
  // Realtime: if this student row changes elsewhere (e.g. another coach
  // ticks a checkpoint), reflect it here.
  useEffect(() => {
    if (!id) return;
    const ch = sb.channel(`student-slideover:${id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'students', filter: `id=eq.${id}` },
        (payload) => setStudent((cur) => (cur ? { ...cur, ...(payload.new as any) } : cur))
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_logs', filter: `student_id=eq.${id}` },
        () => setCallsCount((c) => c + 1)
      )
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [id, sb]);
 
  function close() {
    const p = new URLSearchParams(params.toString());
    p.delete('student');
    router.push(p.toString() ? `?${p.toString()}` as any : '?' as any, { scroll: false });
  }
 
  // Child-driven patch (Progress + Profile tabs call this for optimistic updates).
  function patchStudent(patch: Partial<Student>) {
    setStudent((cur) => (cur ? { ...cur, ...patch } : cur));
  }
 
  return (
    <>
      <div className={cn('fixed inset-0 z-40', open ? 'pointer-events-auto' : 'pointer-events-none')}>
        <div
          onClick={close}
          className={cn('absolute inset-0 bg-ink-950/30 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}
        />
        <aside
          className={cn(
            'absolute right-0 top-0 bottom-0 w-[760px] max-w-[96vw] bg-white shadow-pop flex flex-col transition-transform duration-300',
            open ? 'translate-x-0' : 'translate-x-full'
          )}
          style={{ transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)' }}
        >
          {student ? (
            <>
              <header className="px-7 pt-5 pb-4 border-b border-ink-100">
                <div className="flex items-center gap-2 text-[12px] text-ink-500 mb-3">
                  <button onClick={close} className="hover:text-ink-800 flex items-center gap-1">
                    <ArrowLeft className="w-3.5 h-3.5" /> Students
                  </button>
                  <span className="text-ink-300">/</span>
                  <span className="text-ink-700 font-medium">{student.first_name} {student.last_name}</span>
                  <button onClick={close} className="ml-auto w-7 h-7 rounded-md hover:bg-ink-100 grid place-items-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
 
                <div className="flex items-start gap-4">
                  <StudentAvatar first={student.first_name} last={student.last_name} size={56} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[20px] font-semibold tracking-tight">{student.first_name} {student.last_name}</h2>
                      <StatusPill status={studentStatusFromEnd(student.end_date)} />
                      {student.upgrade_flag && (
                        <span className="text-[10.5px] font-medium text-accent-700 bg-accent-50 ring-1 ring-inset ring-accent-100 px-2 py-0.5 rounded-full">
                          Upgrade candidate
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[12.5px] text-ink-500 mt-1.5">
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {student.email}</span>
                      <span className="text-ink-300">·</span>
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {student.mobile ?? '—'}</span>
                    </div>
                    <TagEditor
                      studentId={student.id}
                      tags={student.tags ?? []}
                      onChange={(tags) => setStudent((s) => (s ? { ...s, tags } : s))}
                    />
                  </div>
                </div>
              </header>
 
              <nav className="px-5 border-b border-ink-100 flex gap-1 overflow-x-auto no-scrollbar">
                <TabBtn t="profile"  label="Profile"  active={tab} onClick={setTab} />
                <TabBtn t="progress" label="Progress" active={tab} onClick={setTab}
                  badge={`${[student.month_1, student.month_2, student.month_3, student.month_4, student.month_5, student.month_6].filter(Boolean).length}/6`} />
                <TabBtn t="calls"    label="Calls"    active={tab} onClick={setTab} badge={String(callsCount)} />
                <TabBtn t="payments" label="Payments" active={tab} onClick={setTab} />
                <TabBtn t="ai"       label="AI Summary" active={tab} onClick={setTab} />
              </nav>
 
              <div className="flex-1 overflow-auto">
                <div className="px-7 py-6">
                  {tab === 'profile' && <ProfileTab student={student} />}
                  {tab === 'progress' && <ProgressTab student={student} onChange={patchStudent} />}
                  {tab === 'calls' && <CallsTab studentId={student.id} />}
                  {tab === 'payments' && <PaymentsTab studentId={student.id} />}
                  {tab === 'ai' && <ProgressAiTab studentId={student.id} />}
                </div>
              </div>
 
              <div className="px-5 py-3 border-t border-ink-100 bg-white flex items-center gap-2">
                <button onClick={() => setTab('calls')} className="h-9 px-3 rounded-lg border border-ink-200 text-[13px] font-medium hover:bg-ink-50 flex items-center gap-1.5">
                  <MessageSquarePlus className="w-4 h-4" /> Log a call
                </button>
                <button onClick={() => setReminderOpen(true)} className="h-9 px-3 rounded-lg border border-ink-200 text-[13px] font-medium hover:bg-ink-50 flex items-center gap-1.5">
                  <Send className="w-4 h-4" /> Send reminder
                </button>
                <div className="ml-auto flex items-center gap-2 text-[11.5px] text-ink-500">
                  <CheckCheck className="w-3.5 h-3.5 text-ink-400" /> Saved
                </div>
              </div>
            </>
          ) : open ? (
            <div className="flex-1 grid place-items-center text-ink-400 text-[13px]">Loading…</div>
          ) : null}
        </aside>
      </div>
 
      {student && (
        <ReminderModal
          open={reminderOpen}
          onClose={() => setReminderOpen(false)}
          studentId={student.id}
        />
      )}
    </>
  );
}
 
function TabBtn({ t, label, badge, active, onClick }: { t: Tab; label: string; badge?: string; active: Tab; onClick: (t: Tab) => void }) {
  const isActive = active === t;
  return (
    <button
      onClick={() => onClick(t)}
      data-active={isActive}
      className={cn(
        'tab-underline shrink-0 px-3 h-10 text-[13px] font-medium flex items-center gap-1.5',
        isActive ? 'text-ink-900' : 'text-ink-500 hover:text-ink-800'
      )}
    >
      {label}
      {badge && (
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', isActive ? 'bg-ink-900 text-white' : 'bg-ink-100')}>
          {badge}
        </span>
      )}
    </button>
  );
}