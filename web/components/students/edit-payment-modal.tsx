'use client';

import { useState } from 'react';
import { X, Pencil, Loader2, AlertTriangle } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/utils';
import { PAYMENT_TYPES } from '@/lib/payment-types';

export function EditPaymentModal({
  open, onClose, onSaved,
  emiId, installmentLabel,
  initialAmount, initialPaidDate, initialMode, initialReference,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  emiId: string;
  installmentLabel: string;
  initialAmount: number;
  initialPaidDate: string;
  initialMode: string;
  initialReference: string;
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const [amount, setAmount] = useState(initialAmount);
  const [paidDate, setPaidDate] = useState(initialPaidDate);
  const [mode, setMode] = useState(initialMode || 'UPI');
  const [reference, setReference] = useState(initialReference || '');
  const [busy, setBusy] = useState(false);
  const [showUnmarkConfirm, setShowUnmarkConfirm] = useState(false);

  // New picks are limited to UPI / NEFT / Card (the single source of truth), but
  // keep an existing record's legacy mode (e.g. "Bank Transfer") selectable so
  // editing an old payment doesn't silently rewrite its mode.
  const modeOptions: string[] =
    initialMode && !(PAYMENT_TYPES as readonly string[]).includes(initialMode)
      ? [initialMode, ...PAYMENT_TYPES]
      : [...PAYMENT_TYPES];

  if (!open) return null;

  async function saveEdit() {
    setBusy(true);
    const patch: any = {
      amount,
      paid_date: paidDate,
      payment_mode: mode,
      payment_link: reference.trim() || null,
    };
    const { error } = await sb.from('emi_schedule').update(patch).eq('id', emiId);
    setBusy(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Payment for installment ${installmentLabel} updated.`, 'success');
    onSaved();
    onClose();
  }

  async function unmarkAsPaid() {
    setBusy(true);
    const patch: any = {
      status: 'upcoming',
      paid_date: null,
      payment_mode: null,
      payment_link: null,
    };
    const { error } = await sb.from('emi_schedule').update(patch).eq('id', emiId);
    setBusy(false);
    if (error) { toast(error.message, 'error'); return; }
    toast(`Installment ${installmentLabel} unmarked. Now upcoming.`, 'success');
    onSaved();
    onClose();
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
            <Pencil className="w-4 h-4 text-accent-600" />
            <div className="font-semibold text-[15px]">Edit payment · {installmentLabel}</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center" aria-label="Close">
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>

        {showUnmarkConfirm ? (
          <div className="p-5">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-[13.5px] text-amber-900 mb-1">Unmark this payment?</div>
                <div className="text-[12.5px] text-amber-800 leading-relaxed">
                  Installment {installmentLabel} ({fmtINR(amount)}) will be reverted to "Upcoming" status.
                  Paid date, mode, and reference will be cleared. You can mark it paid again later.
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setShowUnmarkConfirm(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={unmarkAsPaid} disabled={busy}>
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Unmarking…</> : 'Yes, unmark as paid'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount (₹)">
                  <input
                    type="number"
                    min={0}
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value) || 0)}
                    className={fieldCls}
                  />
                </Field>
                <Field label="Paid date">
                  <input
                    type="date"
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                    className={fieldCls}
                  />
                </Field>
              </div>

              <Field label="Payment mode">
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={fieldCls}>
                  {modeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>

              <Field label="Reference (optional)">
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Transaction ID, cheque number, etc."
                  className={fieldCls}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-ink-100">
              <button
                onClick={() => setShowUnmarkConfirm(true)}
                disabled={busy}
                className="text-[12.5px] font-medium text-rose-700 hover:text-rose-900 disabled:opacity-50"
              >
                Unmark as paid
              </button>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" onClick={saveEdit} disabled={busy}>
                  {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save changes'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fieldCls = 'w-full h-9 px-3 rounded-lg border border-ink-200 focus:border-accent-500 focus:ring-2 focus:ring-accent-100 outline-none text-[13.5px] bg-white';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[12px] font-medium text-ink-700 mb-1">{label}</div>
      {children}
    </label>
  );
}