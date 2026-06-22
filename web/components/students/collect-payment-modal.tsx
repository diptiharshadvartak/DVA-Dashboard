'use client';

import { useState } from 'react';
import { X, IndianRupee, Loader2, Link as LinkIcon, CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { Button } from '@/components/ui/button';
import { fmtINR, fmtDate } from '@/lib/utils';
import { backfillPaymentType, PAYMENT_TYPES } from '@/lib/payment-types';

// Collect a payment toward the outstanding balance with an EDITABLE amount.
// Two modes:
//   • "Record received" → money already in hand. We ALLOCATE it across the
//       existing unpaid installments, oldest due first: each fully-covered
//       installment is marked paid; the one the money runs out on is SPLIT
//       (paid portion + a new upcoming row for the leftover); anything beyond
//       the last unpaid installment is recorded as a standalone "extra" paid
//       row. Already-paid installments are never touched.
//   • "Payment link" → a FUTURE payment. The link is attached to the CURRENT
//       unpaid installment (oldest due first) so paying it settles THAT EMI —
//       it does NOT add a duplicate row. A new upcoming row is created only when
//       there are no unpaid installments left (a genuinely extra collection).
//       The link is shown here to copy/send; the webhook (or Sync) marks it paid.

// Payment-mode options come from the single source of truth (UPI / NEFT / Card).
const MODES = PAYMENT_TYPES;

type UnpaidEmi = {
  id: string;
  amount: number;
  due_date: string;
  installment_no: number;
  installments_total: number;
  label: string;
};

// Pure allocation planner — used for BOTH the live preview and the actual write
// so what the coach sees is exactly what happens. Walks the unpaid installments
// (already sorted oldest-due-first) and spends `amount` across them.
function planAllocation(amount: number, unpaid: UnpaidEmi[]) {
  let remaining = Math.max(0, Math.round(amount));
  const fullyPaid: UnpaidEmi[] = [];
  let split: { emi: UnpaidEmi; paid: number; leftover: number } | null = null;
  for (const emi of unpaid) {
    if (remaining <= 0) break;
    const amt = Number(emi.amount);
    if (remaining >= amt) {
      fullyPaid.push(emi);
      remaining -= amt;
    } else {
      split = { emi, paid: remaining, leftover: amt - remaining };
      remaining = 0;
    }
  }
  // Whatever is left over fell past every unpaid installment → genuine surplus.
  return { fullyPaid, split, surplus: remaining };
}

export function CollectPaymentModal({
  open, onClose, onSaved, studentId, outstanding, defaultAmount, nextInstallmentNo, unpaidEmis,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  studentId: string;
  outstanding: number;
  defaultAmount: number;
  nextInstallmentNo: number;
  unpaidEmis: UnpaidEmi[];
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [method, setMethod] = useState<'received' | 'link'>('link');
  // Default to the next unpaid installment's amount (the typical single
  // collection); fall back to the not-yet-scheduled balance when nothing is due.
  const [amount, setAmount] = useState<number>(
    Math.max(0, Math.round(unpaidEmis[0]?.amount ?? defaultAmount)),
  );
  const [paidDate, setPaidDate] = useState(today);
  const [mode, setMode] = useState('NEFT');
  const [dueDate, setDueDate] = useState(today);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  if (!open) return null;

  const alreadyScheduled = Math.max(0, outstanding - defaultAmount);

  function reminderFor(d: string): string {
    const [y, m, dd] = d.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, dd));
    date.setUTCDate(date.getUTCDate() - 2);
    return date.toISOString().slice(0, 10);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Link copied to clipboard', 'success'))
      .catch(() => toast('Failed to copy', 'error'));
  }

  async function submit() {
    if (busy) return; // guard against double-submit
    if (!(amount > 0)) { toast('Enter an amount greater than 0.', 'error'); return; }
    setBusy(true);

    // ── Record received: allocate the money across existing unpaid EMIs ──
    if (method === 'received') {
      const { fullyPaid, split, surplus } = planAllocation(amount, unpaidEmis);
      // Clear original_amount on every row we settle here so the redistribution
      // trigger does NOT fire during a lump-sum allocation. A "Collect payment"
      // already decides exactly how the money lands across installments; letting
      // the per-row trigger also rewrite sibling amounts mid-batch would scramble
      // that allocation. (Single-EMI mark-paid still redistributes normally.)
      const paidPatch: any = { status: 'paid', paid_date: paidDate, payment_mode: mode, original_amount: null };
      if (reference.trim()) paidPatch.payment_link = reference.trim();

      try {
        // Mark every fully-covered installment paid in one write.
        if (fullyPaid.length) {
          const { error } = await sb
            .from('emi_schedule')
            .update(paidPatch)
            .in('id', fullyPaid.map((e) => e.id));
          if (error) throw error;
        }

        // The installment the money ran out on: existing row keeps the PAID
        // portion, a new upcoming row carries the still-owed leftover.
        if (split) {
          const { error: e1 } = await sb
            .from('emi_schedule')
            .update({ ...paidPatch, amount: split.paid })
            .eq('id', split.emi.id);
          if (e1) throw e1;
          const { error: e2 } = await sb.from('emi_schedule').insert({
            student_id: studentId,
            installment_no: split.emi.installment_no,
            installments_total: split.emi.installments_total,
            amount: split.leftover,
            status: 'upcoming',
            due_date: split.emi.due_date,
            reminder_date: reminderFor(split.emi.due_date),
          });
          if (e2) throw e2;
        }

        // Money beyond every unpaid installment → a standalone extra paid row.
        if (surplus > 0) {
          const { error } = await sb.from('emi_schedule').insert({
            student_id: studentId,
            installment_no: nextInstallmentNo,
            installments_total: nextInstallmentNo,
            amount: surplus,
            status: 'paid',
            due_date: paidDate,
            reminder_date: paidDate,
            paid_date: paidDate,
            payment_mode: mode,
            ...(reference.trim() ? { payment_link: reference.trim() } : {}),
          });
          if (error) throw error;
        }

        // First payment establishes the student's preferred payment type (if unset).
        await backfillPaymentType(sb, studentId, mode);

        setBusy(false);
        const n = fullyPaid.length + (split ? 1 : 0);
        toast(
          `${fmtINR(amount)} recorded via ${mode}` +
            (n ? ` — ${n} installment${n === 1 ? '' : 's'} updated` : '') +
            (surplus > 0 ? ` · ${fmtINR(surplus)} extra` : '') + '.',
          'success',
        );
        onSaved();
        onClose();
      } catch (e: any) {
        // A write failed partway — surface it and refresh so the coach sees the
        // real persisted state rather than a stale view.
        setBusy(false);
        toast(e.message ?? 'Failed to record payment', 'error');
        onSaved();
      }
      return;
    }

    // ── Payment link ──
    // Attach the link to the CURRENT unpaid installment (oldest due first) so
    // paying it settles that EMI — no duplicate row. Only when there are no
    // unpaid installments left do we create a new upcoming row (extra collection).
    const target = unpaidEmis[0] ?? null;
    let emiIdToLink: string;

    if (target) {
      // If the coach changed the amount away from this installment's amount,
      // update it and remember the plan amount so the redistribution trigger
      // rebalances the remaining EMIs on payment (same contract as "Get link").
      if (Math.round(amount) !== Math.round(target.amount)) {
        const { data: cur } = await sb
          .from('emi_schedule')
          .select('amount, original_amount')
          .eq('id', target.id)
          .maybeSingle();
        const planAmount = (cur as any)?.original_amount ?? (cur as any)?.amount ?? target.amount;
        const { error: upErr } = await sb
          .from('emi_schedule')
          .update({ amount, original_amount: planAmount } as any)
          .eq('id', target.id);
        if (upErr) { setBusy(false); toast(upErr.message, 'error'); return; }
      }
      emiIdToLink = target.id;
    } else {
      // No unpaid installments — this is a genuinely extra/unscheduled amount.
      const row: any = {
        student_id: studentId,
        installment_no: nextInstallmentNo,
        installments_total: nextInstallmentNo,
        amount,
        status: 'upcoming',
        due_date: dueDate,
        reminder_date: reminderFor(dueDate),
      };
      const { data: created, error } = await sb.from('emi_schedule').insert(row).select('id').single();
      if (error) { setBusy(false); toast(error.message, 'error'); return; }
      emiIdToLink = (created as any).id;
    }

    // Generate the Cashfree link for the chosen installment, then show it.
    try {
      const res = await fetch('/api/cashfree/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emiId: emiIdToLink }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed to generate link');
      setBusy(false);
      onSaved();                       // refresh the tab behind the modal
      setCreatedLink(data.link_url ?? '');
      toast(`Payment link for ${fmtINR(amount)} created.`, 'success');
    } catch (e: any) {
      // The link failed (amount change, if any, persisted). Surface it; the coach
      // can retry "Get link" on the installment.
      setBusy(false);
      toast(`Link failed: ${e.message}`, 'error');
      onSaved();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[8vh] px-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[480px] bg-white rounded-2xl shadow-pop border border-ink-200/70 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-ink-500" />
            <div className="font-semibold text-[15px]">Collect payment</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center" aria-label="Close">
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>

        {createdLink ? (
          // ---- Link ready: copy / open / send ----
          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 font-semibold text-[13.5px]">
              <CheckCircle2 className="w-4 h-4" /> Payment link ready
            </div>
            <div className="text-[12px] text-ink-600">
              Share this link with the student to collect {fmtINR(amount)}. They&apos;ll pay on Cashfree and the installment is marked paid automatically.
            </div>
            <div className="flex items-center gap-2 bg-ink-50 border border-ink-200 rounded-lg px-3 py-2">
              <input readOnly value={createdLink} className="flex-1 bg-transparent text-[12px] text-ink-700 outline-none truncate" />
              <button onClick={() => copy(createdLink)} className="text-ink-600 hover:text-ink-900" title="Copy link"><Copy className="w-4 h-4" /></button>
              <a href={createdLink} target="_blank" rel="noopener noreferrer" className="text-accent-700 hover:text-accent-900" title="Open link"><ExternalLink className="w-4 h-4" /></a>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              {outstanding > 0 && (
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 text-[12.5px] text-ink-700 space-y-0.5">
                  <div>Outstanding balance: <span className="font-semibold">{fmtINR(outstanding)}</span></div>
                  {alreadyScheduled > 0 && (
                    <div className="text-[11.5px] text-ink-500">
                      {fmtINR(alreadyScheduled)} already scheduled in unpaid installments · {fmtINR(defaultAmount)} not yet scheduled
                    </div>
                  )}
                </div>
              )}

              {/* Method toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('link')}
                  className={`h-9 rounded-lg text-[12.5px] font-medium border flex items-center justify-center gap-1.5 ${method === 'link' ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
                >
                  <LinkIcon className="w-3.5 h-3.5" /> Payment link
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('received')}
                  className={`h-9 rounded-lg text-[12.5px] font-medium border flex items-center justify-center gap-1.5 ${method === 'received' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Record received
                </button>
              </div>

              <Field label="Amount (₹)">
                <input
                  type="number"
                  min={1}
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value) || 0)}
                  className={fieldCls}
                  placeholder="Enter amount to collect"
                  autoFocus
                />
              </Field>

              {method === 'received' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Payment date">
                      <input type="date" value={paidDate} max={today} onChange={(e) => setPaidDate(e.target.value)} className={fieldCls} />
                    </Field>
                    <Field label="Payment mode">
                      <select value={mode} onChange={(e) => setMode(e.target.value)} className={fieldCls}>
                        {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="Reference / note (optional)">
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UPI txn ID, cheque no." className={fieldCls} />
                  </Field>

                  {/* Live preview of how this amount lands on the EMI schedule. */}
                  {amount > 0 && (() => {
                    const { fullyPaid, split, surplus } = planAllocation(amount, unpaidEmis);
                    if (!fullyPaid.length && !split && surplus === 0) return null;
                    return (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] space-y-1">
                        <div className="font-medium text-emerald-800">This payment will:</div>
                        {fullyPaid.map((e) => (
                          <div key={e.id} className="flex items-center justify-between text-emerald-700">
                            <span>✓ Mark EMI {e.label} paid</span>
                            <span className="font-medium">{fmtINR(e.amount)}</span>
                          </div>
                        ))}
                        {split && (
                          <div className="flex items-center justify-between text-emerald-700">
                            <span>◐ Part-pay EMI {split.emi.label} · {fmtINR(split.leftover)} still due</span>
                            <span className="font-medium">{fmtINR(split.paid)}</span>
                          </div>
                        )}
                        {surplus > 0 && (
                          <div className="flex items-center justify-between text-amber-700">
                            <span>+ Extra (fee fully cleared)</span>
                            <span className="font-medium">{fmtINR(surplus)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : unpaidEmis[0] ? (
                // Link collects the current unpaid installment — show which one,
                // not a due-date field (the installment already has its date).
                <div className="rounded-lg border border-accent-200 bg-accent-50/60 px-3 py-2.5 text-[12px] text-accent-800">
                  This link collects <span className="font-semibold">EMI {unpaidEmis[0].label}</span> (due {fmtDate(unpaidEmis[0].due_date)}).
                  When the student pays, that installment is marked paid — no extra installment is added.
                  {Math.round(amount) !== Math.round(unpaidEmis[0].amount) && (
                    <div className="mt-1 text-accent-700">
                      Amount differs from the planned {fmtINR(unpaidEmis[0].amount)} — the remaining installments rebalance once this is paid.
                    </div>
                  )}
                </div>
              ) : (
                <Field label="Due date">
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldCls} />
                </Field>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink-100">
              <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={submit} disabled={busy}>
                {busy
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {method === 'link' ? 'Creating link…' : 'Saving…'}</>
                  : method === 'link'
                    ? <><LinkIcon className="w-3.5 h-3.5" /> Create link</>
                    : <><CheckCircle2 className="w-3.5 h-3.5" /> Record payment</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fieldCls = 'w-full h-9 px-3 rounded-lg border border-ink-200 text-[13px] focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100 bg-white';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11.5px] font-medium text-ink-700 mb-1">{label}</div>
      {children}
    </label>
  );
}
