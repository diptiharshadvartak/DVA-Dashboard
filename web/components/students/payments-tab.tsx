'use client';

import { useEffect, useMemo, useState } from 'react';
import { IndianRupee, Plus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtINR, fmtDate } from '@/lib/utils';
import { ReminderModal } from '@/components/reminders/reminder-modal';
import { EmiSetupModal } from './emi-setup-modal';
import { MarkPaidModal } from './mark-paid-modal';
import type { Database } from '@/types/database';

type Emi = Database['public']['Tables']['emi_schedule']['Row'];
type StudentSlim = {
  total_fee: number | null;
  down_payment: number | null;
  down_payment_date: string | null;
};

export function PaymentsTab({ studentId }: { studentId: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [rows, setRows] = useState<Emi[]>([]);
  const [student, setStudent] = useState<StudentSlim | null>(null);
  const [reminderEmi, setReminderEmi] = useState<string | null>(null);
  const [payEmi, setPayEmi] = useState<Emi | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const [{ data: emi }, { data: stu }] = await Promise.all([
      sb.from('emi_schedule').select('*').eq('student_id', studentId).order('installment_no'),
      sb.from('students').select('total_fee, down_payment, down_payment_date').eq('id', studentId).maybeSingle(),
    ]);
    setRows((emi ?? []) as Emi[]);
    setStudent((stu as any) ?? null);
    setLoaded(true);
  }

  useEffect(() => { let cancel = false; (async () => { await load(); })().catch(() => {}); return () => { cancel = true; }; /* eslint-disable-next-line */ }, [studentId, sb]);

  const totalEmi    = rows.reduce((s, r) => s + Number(r.amount), 0);
  const paidEmi     = rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const downPayment = Number(student?.down_payment ?? 0);
  const totalFee    = Number(student?.total_fee ?? (totalEmi + downPayment));
  const totalPaid   = paidEmi + downPayment;
  const outstanding = Math.max(0, totalFee - totalPaid);

  // Detect mismatch between configured total fee and what the EMI plan actually covers.
  // mismatch > 0 means the EMI plan + down payment is LESS than total fee (under-collected).
  // mismatch < 0 means EMIs would over-collect.
  const planTotal = totalEmi + downPayment;
  const mismatch = totalFee > 0 ? totalFee - planTotal : 0;

  if (!loaded) return <div className="text-[13px] text-ink-500">Loading…</div>;

  // No EMI plan + no down payment → empty state
  if (rows.length === 0 && !downPayment) {
    return (
      <>
        <div className="bg-white border border-ink-200/70 rounded-xl p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-ink-100 grid place-items-center mb-3">
            <IndianRupee className="w-5 h-5 text-ink-500" />
          </div>
          <div className="font-semibold text-[14px]">No payment plan yet</div>
          <p className="text-[12.5px] text-ink-500 mt-1 mb-4 max-w-[320px] mx-auto">
            Set up a course fee, down payment, and EMI schedule for this student.
          </p>
          <Button variant="primary" onClick={() => setSetupOpen(true)}>
            <Plus className="w-4 h-4" /> Set up EMI plan
          </Button>
        </div>
        {setupOpen && <EmiSetupModal studentId={studentId} onClose={() => setSetupOpen(false)} onSaved={load} />}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Total fee" value={fmtINR(totalFee)} sub={rows.length ? `${rows.length} installments + downpayment` : 'down payment only'} />
        <Kpi label="Down payment" value={fmtINR(downPayment)} sub={student?.down_payment_date ? `paid ${fmtDate(student.down_payment_date)}` : downPayment > 0 ? 'paid' : 'not set'} tone={downPayment > 0 ? 'good' : 'neutral'} />
        <Kpi label="Paid so far" value={fmtINR(totalPaid)} sub={`${rows.filter(r=>r.status==='paid').length} of ${rows.length} EMIs paid`} tone="good" />
        <Kpi label="Outstanding" value={fmtINR(outstanding)} sub={rows.filter(r => r.status !== 'paid').length + ' EMIs left'} tone={outstanding > 0 ? 'warn' : 'good'} />
      </div>

      {Math.abs(mismatch) > 1 && (
        <div className="bg-amber-50/70 border border-amber-300 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13.5px] text-amber-900">EMI plan doesn't match total fee</div>
            <div className="text-[12px] text-amber-800 mt-1 leading-relaxed">
              Total fee is {fmtINR(totalFee)} but the plan covers only {fmtINR(planTotal)} (₹{Math.abs(mismatch).toLocaleString('en-IN')} {mismatch > 0 ? 'short' : 'extra'}).
              <br />
              Down payment {fmtINR(downPayment)} + {rows.length} EMIs of {fmtINR(rows[0]?.amount ?? 0)} = {fmtINR(planTotal)}.
            </div>
            <button
              onClick={() => setSetupOpen(true)}
              className="mt-2 h-7 px-3 rounded-md bg-amber-700 hover:bg-amber-800 text-white text-[11.5px] font-medium inline-flex items-center gap-1"
            >
              Fix EMI plan
            </button>
          </div>
        </div>
      )}

      {/* Down payment row (always shown if there is one) */}
      {downPayment > 0 && (
        <div className="bg-emerald-50/60 border border-emerald-200/70 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center">
            <IndianRupee className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13.5px]">Down payment</div>
            <div className="text-[11.5px] text-ink-500">
              {student?.down_payment_date ? `Received on ${fmtDate(student.down_payment_date)}` : 'Received'}
            </div>
          </div>
          <div className="text-[15px] font-semibold">{fmtINR(downPayment)}</div>
          <StatusPill status="paid" />
        </div>
      )}

      {/* EMI rows */}
      {rows.length > 0 ? (
        <div className="bg-white border border-ink-200/70 rounded-xl">
          <div className="px-4 py-2.5 border-b border-ink-100 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-ink-700">EMI schedule</div>
            <div className="text-[11px] text-ink-500">{rows.length} installments</div>
          </div>
          <div className="grid grid-cols-[60px_1fr_120px_140px_180px] gap-3 px-4 py-2 border-b border-ink-100 text-[10.5px] uppercase tracking-wider text-ink-500 font-semibold">
            <div>#</div><div>Amount</div><div>Due date</div><div>Status</div><div className="text-right">Action</div>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[60px_1fr_120px_140px_180px] gap-3 px-4 py-3 items-center border-b border-ink-100 last:border-0 text-[13px]">
              <div className="font-mono text-[11.5px] text-ink-500">{r.installment_no}/{r.installments_total}</div>
              <div>{fmtINR(Number(r.amount))}</div>
              <div className="text-ink-600">{fmtDate(r.due_date)}</div>
              <div><StatusPill status={r.status} /></div>
              <div className="text-right">
                {r.status === 'paid' ? (
                  <div className="text-[11.5px] text-ink-500 leading-tight">
                    <div>Paid {fmtDate(r.paid_date)}</div>
                    {r.payment_mode && (
                      <div className="text-[10.5px] text-emerald-700 font-medium">via {r.payment_mode}</div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => setReminderEmi(r.id)}
                      className="text-[11.5px] font-medium text-ink-600 hover:text-ink-900 hover:underline"
                    >
                      Remind
                    </button>
                    <span className="text-ink-300">·</span>
                    <button
                      onClick={() => setPayEmi(r)}
                      className="text-[11.5px] font-medium text-emerald-700 hover:underline inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Mark paid
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-ink-200/70 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="font-medium text-[13.5px]">No EMI schedule yet</div>
            <div className="text-[12px] text-ink-500">Add monthly installments for the remaining balance.</div>
          </div>
          <Button variant="primary" onClick={() => setSetupOpen(true)}>
            <Plus className="w-4 h-4" /> Add EMI plan
          </Button>
        </div>
      )}

      {reminderEmi && (
        <ReminderModal open={!!reminderEmi} onClose={() => setReminderEmi(null)} studentId={studentId} emiId={reminderEmi} />
      )}
      {payEmi && (
        <MarkPaidModal
          open={!!payEmi}
          onClose={() => setPayEmi(null)}
          onSaved={load}
          emiId={payEmi.id}
          amount={Number(payEmi.amount)}
          installmentLabel={`${payEmi.installment_no}/${payEmi.installments_total}`}
        />
      )}
      {setupOpen && <EmiSetupModal studentId={studentId} onClose={() => setSetupOpen(false)} onSaved={load} />}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'warn' }) {
  const subCls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink-500';
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-4">
      <div className="text-[11.5px] uppercase tracking-wider text-ink-500 font-semibold">{label}</div>
      <div className="text-[20px] font-semibold tracking-tight mt-1">{value}</div>
      {sub && <div className={`text-[11.5px] ${subCls}`}>{sub}</div>}
    </div>
  );
}