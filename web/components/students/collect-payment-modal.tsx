'use client';

import { useState } from 'react';
import { X, IndianRupee, Loader2, Link as LinkIcon, CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/utils';

// Collect a payment toward the outstanding balance with an EDITABLE amount.
// There is no fixed EMI plan in the payment-history model — paid amounts are
// recorded as installments and the outstanding is (total fee − paid). This
// modal adds one more payment:
//   • "Record received"  → inserts a paid emi_schedule row (offline payment)
//   • "Payment link"     → inserts an upcoming row + generates a Cashfree link;
//                          the link is shown here to copy/send, and the webhook
//                          marks it paid when the student pays.
// The amount defaults to the balance NOT already covered by unpaid installments
// so it never double-schedules money that's already on the plan.

const MODES = ['UPI', 'Bank Transfer', 'NEFT', 'Cash', 'Card', 'Cheque', 'Wallet', 'Other'];

export function CollectPaymentModal({
  open, onClose, onSaved, studentId, outstanding, defaultAmount, nextInstallmentNo,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  studentId: string;
  outstanding: number;
  defaultAmount: number;
  nextInstallmentNo: number;
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [method, setMethod] = useState<'received' | 'link'>('link');
  const [amount, setAmount] = useState<number>(Math.max(0, Math.round(defaultAmount)));
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

    const base: any = {
      student_id: studentId,
      installment_no: nextInstallmentNo,
      installments_total: nextInstallmentNo,
      amount,
    };

    const row =
      method === 'received'
        ? { ...base, status: 'paid', due_date: paidDate, reminder_date: paidDate, paid_date: paidDate, payment_mode: mode, ...(reference.trim() ? { payment_link: reference.trim() } : {}) }
        : { ...base, status: 'upcoming', due_date: dueDate, reminder_date: reminderFor(dueDate) };

    const { data: created, error } = await sb.from('emi_schedule').insert(row).select('id').single();
    if (error) {
      setBusy(false);
      toast(error.message, 'error');
      return;
    }

    if (method === 'received') {
      setBusy(false);
      toast(`Payment of ${fmtINR(amount)} recorded via ${mode}.`, 'success');
      onSaved();
      onClose();
      return;
    }

    // Generate the Cashfree link, then show it here so the coach can copy/send.
    try {
      const res = await fetch('/api/cashfree/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emiId: (created as any).id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed to generate link');
      setBusy(false);
      onSaved();                       // refresh the tab behind the modal
      setCreatedLink(data.link_url ?? '');
      toast(`Payment link for ${fmtINR(amount)} created.`, 'success');
    } catch (e: any) {
      // The installment was created; only the link failed. Keep the row (the
      // coach can retry "Get link" on it) and surface the error.
      setBusy(false);
      toast(`Installment added, but link failed: ${e.message}`, 'error');
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
                </>
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
