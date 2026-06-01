'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X, Sparkles } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fmtDate, fmtINR, achievementTags, cn } from '@/lib/utils';
import { VoiceButton } from './voice-button';
import { EmiSetupModal } from './emi-setup-modal';
import { useToast } from '@/components/shell/toast-region';
import type { Database } from '@/types/database';

type Student = Database['public']['Tables']['students']['Row'] & {
  dipti_comments?: string | null;
};

const MEMBERSHIP_OPTIONS = [
  '', '💎 3A', '💎 LT', '💎 E', '💎 A', '💎 4A', '💎 Dep',
  '💎 3A (EMI)', '💎 LT (EMI)', '💎 E (EMI)', '💎 A (EMI)',
  '💎 E EMI Default', '💎 A EMI Default', 'LT EMI Default', 'Dep Default',
  'Ex-💎', 'R💎 Deposit', 'on hold 💎 Dep', 'Settled',
];

export function ProfileTab({ student, onChange }: { student: Student; onChange?: (patch: Partial<Student>) => void }) {
  const sb = supabaseBrowser();
  const [emiPaid, setEmiPaid] = useState<number>(0);
  const [emiCount, setEmiCount] = useState<{ paid: number; total: number }>({ paid: 0, total: 0 });
  const [paidInstallments, setPaidInstallments] = useState<{ amount: number; date: string | null; mode: string | null }[]>([]);
  // Lets the user edit the fee / down payment / EMI plan right from the
  // Profile tab (same modal the Payments tab uses). payRefresh forces the
  // summary below to re-fetch after a save, even when the change is one the
  // student-row realtime sub doesn't cover (e.g. only emi_schedule changed).
  const [editPayOpen, setEditPayOpen] = useState(false);
  const [payRefresh, setPayRefresh] = useState(0);

  // Fetch payment summary + individual paid installments from emi_schedule
  useEffect(() => {
    (async () => {
      const { data } = await sb
        .from('emi_schedule')
        .select('amount, status, paid_date, payment_mode, installment_no')
        .eq('student_id', student.id)
        .order('installment_no', { ascending: true });
      let paid = 0, paidCount = 0, total = 0;
      const list: { amount: number; date: string | null; mode: string | null }[] = [];
      for (const e of (data ?? []) as any[]) {
        total++;
        if (e.status === 'paid') {
          paid += Number(e.amount ?? 0); paidCount++;
          list.push({ amount: Number(e.amount ?? 0), date: e.paid_date, mode: e.payment_mode });
        }
      }
      const fp = Number((student as any).full_payment_amount ?? 0);
      if (fp > 0 && total === 0) { paid = fp; paidCount = 1; total = 1; }
      // The down payment is stored on the student record (not as an
      // emi_schedule row in the EMI-ratio import path), so it must be added to
      // the paid total — otherwise "Total paid"/"Outstanding" here disagree
      // with the Payments tab, which already counts it (paidEmi + downPayment).
      const dp = Number((student as any).down_payment ?? 0);
      // Count the down payment as a payment too, so the installment count
      // reconciles with the rupee total (which already includes it).
      if (dp > 0) { paid += dp; paidCount++; total++; }
      setEmiPaid(paid);
      setEmiCount({ paid: paidCount, total });
      setPaidInstallments(list);
    })();
  }, [student.id, sb, (student as any).full_payment_amount, (student as any).down_payment, payRefresh]);
  const { toast } = useToast();

  const [bg, setBg] = useState(student.background ?? '');
  const [savedBg, setSavedBg] = useState(student.background ?? '');
  const [editingBg, setEditingBg] = useState(false);

  const [diptiNotes, setDiptiNotes] = useState(student.dipti_comments ?? '');
  const [savedDiptiNotes, setSavedDiptiNotes] = useState(student.dipti_comments ?? '');
  const [editingDipti, setEditingDipti] = useState(false);

  const [editingIdentity, setEditingIdentity] = useState(false);
  const [firstName, setFirstName] = useState(student.first_name ?? '');
  const [lastName, setLastName] = useState(student.last_name ?? '');
  const [email, setEmail] = useState(student.email ?? '');
  const [mobile, setMobile] = useState(student.mobile ?? '');

  const [editingProgram, setEditingProgram] = useState(false);
  const [membership, setMembership] = useState(student.membership ?? '');
  const [startDate, setStartDate] = useState((student as any).course_start_date ?? '');
  const [endDate, setEndDate] = useState((student as any).course_end_date ?? '');

  const lastStudentId = useRef<string>(student.id);
  useEffect(() => {
    if (lastStudentId.current !== student.id) {
      setBg(student.background ?? '');
      setSavedBg(student.background ?? '');
      setEditingBg(false);
      setDiptiNotes(student.dipti_comments ?? '');
      setSavedDiptiNotes(student.dipti_comments ?? '');
      setEditingDipti(false);
      setFirstName(student.first_name ?? '');
      setLastName(student.last_name ?? '');
      setEmail(student.email ?? '');
      setMobile(student.mobile ?? '');
      setEditingIdentity(false);
      setMembership(student.membership ?? '');
      setStartDate((student as any).course_start_date ?? '');
      setEndDate((student as any).course_end_date ?? '');
      setEditingProgram(false);
      lastStudentId.current = student.id;
    }
  }, [student.id, student.background, student.dipti_comments, student.first_name, student.last_name, student.email, student.mobile, student.membership, (student as any).course_start_date, (student as any).course_end_date]);

  async function saveBg() {
    const newValue = bg;
    const { error } = await sb.from('students').update({ background: newValue }).eq('id', student.id);
    if (error) { toast(error.message, 'error'); return; }
    setSavedBg(newValue);
    onChange?.({ background: newValue });
    setEditingBg(false);
    toast('Saved', 'success');
  }

  async function saveDipti() {
    const newValue = diptiNotes;
    const { error } = await sb.from('students').update({ dipti_comments: newValue } as any).eq('id', student.id);
    if (error) { toast(error.message, 'error'); return; }
    setSavedDiptiNotes(newValue);
    onChange?.({ dipti_comments: newValue });
    setEditingDipti(false);
    toast("Dipti's notes saved", 'success');
  }

  async function saveIdentity() {
    const patch = {
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      email: email.trim().toLowerCase(),
      mobile: mobile.trim() || null,
    };
    const { error } = await sb.from('students').update(patch).eq('id', student.id);
    if (error) { toast(error.message, 'error'); return; }
    // Push the saved values up so the displayed prop updates immediately.
    // Without this the Identity fields read from the stale `student` prop and
    // revert to the old value when edit mode closes.
    onChange?.(patch);
    setEditingIdentity(false);
    toast('Identity updated', 'success');
  }

  async function saveProgram() {
    const patch = {
      membership: membership.trim() || null,
      course_start_date: startDate || null,
      course_end_date: endDate || null,
    };
    const { error } = await sb.from('students').update(patch).eq('id', student.id);
    if (error) { toast(error.message, 'error'); return; }
    onChange?.(patch as Partial<Student>);
    setEditingProgram(false);
    toast('Program updated', 'success');
  }

  function cancelBg() { setBg(savedBg); setEditingBg(false); }
  function cancelDipti() { setDiptiNotes(savedDiptiNotes); setEditingDipti(false); }
  function cancelIdentity() {
    setFirstName(student.first_name ?? '');
    setLastName(student.last_name ?? '');
    setEmail(student.email ?? '');
    setMobile(student.mobile ?? '');
    setEditingIdentity(false);
  }
  function cancelProgram() {
    setMembership(student.membership ?? '');
    setStartDate((student as any).course_start_date ?? '');
    setEndDate((student as any).course_end_date ?? '');
    setEditingProgram(false);
  }

  return (
    <div className="space-y-7">
      {/* DIPTI'S NOTES */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[12px] uppercase tracking-wider font-bold flex items-center gap-1.5 text-ink-900">
            <span className="inline-block w-1 h-3.5 bg-rose-500 rounded-sm" />
            <Sparkles className="w-3 h-3 text-rose-500" /> Dipti Mams's Notes
          </h3>
        </div>
        <div className="bg-white border-2 border-l-4 border-rose-400 rounded-xl p-5 shadow-sm">
          {editingDipti ? (
            <textarea
              value={diptiNotes}
              onChange={(e) => setDiptiNotes(e.target.value)}
              rows={4}
              className="w-full text-[13.5px] leading-relaxed outline-none resize-none bg-white text-ink-900 placeholder:text-ink-400"
              placeholder="Dipti's personal notes about this student…"
              autoFocus
            />
          ) : (
            <div className="text-[13.5px] leading-relaxed text-ink-900 min-h-[1.5em] whitespace-pre-line font-medium">
              {savedDiptiNotes || <span className="text-ink-500 italic font-normal">No notes from Dipti yet.</span>}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-ink-100 flex items-center gap-2">
            {editingDipti ? (
              <>
                <button onClick={saveDipti} className="h-7 px-2.5 rounded-md text-[11.5px] font-semibold bg-rose-600 text-white hover:bg-rose-700 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Save
                </button>
                <button onClick={cancelDipti} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditingDipti(true)} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
            <VoiceButton onTranscript={(text) => { setDiptiNotes((b) => (b ? b + '\n\n' : '') + text); setEditingDipti(true); }} />
          </div>
        </div>
      </div>

      {/* IDENTITY */}
      <div>
        <SectionHeader title="Identity" editing={editingIdentity} onEdit={() => setEditingIdentity(true)} onSave={saveIdentity} onCancel={cancelIdentity} />
        <div className="bg-white border border-ink-200/70 rounded-xl px-5">
          <EditableField label="First name" editing={editingIdentity} value={firstName} display={student.first_name ?? '—'} onChange={setFirstName} />
          <EditableField label="Last name" editing={editingIdentity} value={lastName} display={student.last_name ?? '—'} onChange={setLastName} />
          <EditableField label="Email" editing={editingIdentity} value={email} display={student.email} type="email" onChange={setEmail} />
          <EditableField label="Mobile" editing={editingIdentity} value={mobile} display={student.mobile ?? '—'} type="tel" onChange={setMobile} />
          <Field label="Alternate number" value={(student as any).alternate_number ?? '—'} />
          <Field label="Profile link" value={(student as any).profile_link
            ? <a href={(student as any).profile_link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-[260px]">{(student as any).profile_link}</a>
            : '—'} />
        </div>
      </div>

      {/* PROGRAM */}
      <div>
        <SectionHeader title="Program" editing={editingProgram} onEdit={() => setEditingProgram(true)} onSave={saveProgram} onCancel={cancelProgram} />
        <div className="bg-white border border-ink-200/70 rounded-xl px-5">
          {editingProgram ? (
            <EditableField
              label="Membership"
              editing
              value={membership}
              display={student.membership ?? '—'}
              onChange={setMembership}
              isSelect
              options={MEMBERSHIP_OPTIONS}
            />
          ) : (
            <Field label="Membership" value={<span className="font-medium">{student.membership ?? '—'}</span>} />
          )}
          <Field label="Tags" value={(achievementTags(student as any).length || student.tags?.length)
            ? <>{achievementTags(student as any).map((t) => <span key={t} className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mr-1">{t}</span>)}{(student.tags ?? []).map((t) => <span key={t} className="text-[10.5px] font-medium px-1.5 py-0.5 rounded bg-ink-100 text-ink-700 mr-1">{t}</span>)}</>
            : <span className="text-ink-400">none</span>} />
          <Field label="Group" value={(student as any).student_group ?? '—'} />
          <EditableField label="Course start date" editing={editingProgram} value={startDate} display={fmtDate((student as any).course_start_date)} type="date" onChange={setStartDate} />
          <EditableField label="Course end date" editing={editingProgram} value={endDate} display={fmtDate((student as any).course_end_date)} type="date" onChange={setEndDate} />
        </div>
      </div>

      {/* PAYMENTS SUMMARY (auto-computed) */}
      {(() => {
        const totalFee = Number(student.total_fee ?? 0);
        const outstanding = Math.max(0, totalFee - emiPaid);
        const status = (
          totalFee === 0 ? 'No fee set' :
          outstanding === 0 && emiPaid > 0 ? 'Fully Paid' :
          emiPaid > 0 ? 'Partially Paid' :
          'Not Started'
        );
        const statusColor = (
          status === 'Fully Paid' ? 'bg-emerald-100 text-emerald-800' :
          status === 'Partially Paid' ? 'bg-amber-100 text-amber-800' :
          status === 'Not Started' ? 'bg-ink-100 text-ink-600' :
          'bg-ink-100 text-ink-500'
        );
        return (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[12px] uppercase tracking-wider text-ink-500 font-semibold">Payments</h3>
              <button
                onClick={() => setEditPayOpen(true)}
                className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="bg-white border border-ink-200/70 rounded-xl px-5">
              <Field label="Status" value={<span className={cn('inline-flex items-center text-[11.5px] font-semibold px-2 py-0.5 rounded-full', statusColor)}>{status === 'Fully Paid' ? '✅ ' : status === 'Partially Paid' ? '⏳ ' : ''}{status}</span>} />
              <Field label="Total fee" value={<span className="font-semibold">{fmtINR(totalFee)}</span>} />
              <Field label="Total paid" value={<span className="font-semibold text-emerald-700">{fmtINR(emiPaid)} <span className="text-[11px] text-ink-500 font-normal ml-1">({emiCount.paid}/{emiCount.total} installments)</span></span>} />
              <Field label="Outstanding" value={<span className={cn('font-semibold', outstanding > 0 ? 'text-rose-700' : 'text-ink-500')}>{fmtINR(outstanding)}</span>} />
              {(student as any).down_payment ? (
                <Field label="Down payment" value={<>{fmtINR((student as any).down_payment)} {(student as any).down_payment_date && <span className="text-[11px] text-ink-500 ml-2">on {fmtDate((student as any).down_payment_date)}</span>}</>} />
              ) : null}
              {(student as any).full_payment_amount ? (
                <Field label="Full payment" value={<>{fmtINR((student as any).full_payment_amount)} {(student as any).full_payment_date && <span className="text-[11px] text-ink-500 ml-2">on {fmtDate((student as any).full_payment_date)}</span>}</>} />
              ) : null}
              {paidInstallments.length > 0 && (
                <Field label="All payments" value={
                  <div className="flex flex-col gap-0.5 py-1">
                    {paidInstallments.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px]">
                        <span className="font-medium text-ink-900">#{i+1}</span>
                        <span className="font-semibold text-emerald-700">{fmtINR(p.amount)}</span>
                        <span className="text-[11px] text-ink-500">{p.date ? fmtDate(p.date) : '—'}</span>
                        {p.mode && <span className="text-[10.5px] text-ink-400">({p.mode})</span>}
                      </div>
                    ))}
                  </div>
                } />
              )}
            </div>
          </div>
        );
      })()}

      {/* BACKGROUND */}
      <div>
        <h3 className="text-[12px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Background</h3>
        <div className="bg-white border border-ink-200/70 rounded-xl p-5">
          {editingBg ? (
            <textarea
              value={bg} onChange={(e) => setBg(e.target.value)}
              rows={4}
              className="w-full text-[13.5px] leading-relaxed outline-none resize-none placeholder:text-ink-400"
              placeholder="What's the student's story? Personality, key context, things to remember…"
              autoFocus
            />
          ) : (
            <div className="text-[13.5px] leading-relaxed text-ink-800 min-h-[1.5em] whitespace-pre-line">
              {savedBg || <span className="text-ink-400">No background recorded yet.</span>}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-ink-100 flex items-center gap-2">
            {editingBg ? (
              <>
                <button onClick={saveBg} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium btn-primary">Save</button>
                <button onClick={cancelBg} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditingBg(true)} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            )}
            <VoiceButton onTranscript={(text) => { setBg((b) => (b ? b + '\n\n' : '') + text); setEditingBg(true); }} />
          </div>
        </div>
      </div>

      {editPayOpen && (
        <EmiSetupModal
          studentId={student.id}
          onClose={() => setEditPayOpen(false)}
          onSaved={() => setPayRefresh((x) => x + 1)}
        />
      )}
    </div>
  );
}

function SectionHeader({ title, editing, onEdit, onSave, onCancel }: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[12px] uppercase tracking-wider text-ink-500 font-semibold">{title}</h3>
      {editing ? (
        <div className="flex gap-1">
          <button onClick={onSave} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium btn-primary flex items-center gap-1">
            <Check className="w-3 h-3" /> Save
          </button>
          <button onClick={onCancel} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1">
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      ) : (
        <button onClick={onEdit} className="h-7 px-2.5 rounded-md text-[11.5px] font-medium border border-ink-200 hover:bg-ink-50 flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Edit
        </button>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-2.5 border-b border-ink-100 last:border-0">
      <div className="text-[12px] text-ink-500 font-medium">{label}</div>
      <div className="text-[13.5px]">{value}</div>
    </div>
  );
}

function EditableField({
  label, editing, value, display, onChange, type = 'text', isSelect = false, options = [],
}: {
  label: string;
  editing: boolean;
  value: string;
  display: React.ReactNode;
  onChange: (v: string) => void;
  type?: 'text' | 'email' | 'tel' | 'date';
  isSelect?: boolean;
  options?: string[];
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-3 py-2.5 border-b border-ink-100 last:border-0">
      <div className="text-[12px] text-ink-500 font-medium">{label}</div>
      <div className="text-[13.5px]">
        {editing ? (
          isSelect ? (
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-8 px-2 text-[13px] border border-ink-200 rounded-md outline-none focus:border-accent-500 bg-white"
            >
              {options.map((opt) => (
                <option key={opt} value={opt}>{opt || '— None —'}</option>
              ))}
            </select>
          ) : (
            <input
              type={type}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-8 px-2 text-[13px] border border-ink-200 rounded-md outline-none focus:border-accent-500"
            />
          )
        ) : (
          display
        )}
      </div>
    </div>
  );
}