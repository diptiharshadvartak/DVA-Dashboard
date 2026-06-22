'use client';

import { useState } from 'react';
import { X, CheckCircle2, Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { Button } from '@/components/ui/button';
import { fmtINR } from '@/lib/utils';
import { backfillPaymentType, PAYMENT_TYPES } from '@/lib/payment-types';

// Captures payment date + payment mode + optional reference and marks an EMI paid.
// Reuses the existing emi_schedule columns:
//   status = 'paid'
//   paid_date  = chosen date
//   payment_mode = chosen mode
//   payment_link = optional reference (e.g. txn id) — reused since it's a free text column

// Payment-mode options come from the single source of truth (UPI / NEFT / Card).
const MODES = PAYMENT_TYPES;

export function MarkPaidModal({
  open, onClose, onSaved, emiId, studentId, amount, installmentLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  emiId: string;
  studentId?: string;
  amount: number;
  installmentLabel: string;
}) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [paidDate, setPaidDate] = useState(today);
  const [mode, setMode] = useState('UPI');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function save() {
    setBusy(true);
    const patch: any = {
      status: 'paid',
      paid_date: paidDate,
      payment_mode: mode,
    };
    if (reference.trim()) patch.payment_link = reference.trim();

    const { error } = await sb.from('emi_schedule').update(patch).eq('id', emiId);
    if (error) {
      setBusy(false);
      toast(error.message, 'error');
      return;
    }
    // First payment establishes the student's preferred payment type (if unset).
    if (studentId) await backfillPaymentType(sb, studentId, mode);
    setBusy(false);
    toast(`Installment ${installmentLabel} marked paid via ${mode}.`, 'success');
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
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <div className="font-semibold text-[15px]">Mark installment paid</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center" aria-label="Close">
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 text-[12.5px] text-ink-700">
            Installment <span className="font-mono font-semibold">{installmentLabel}</span> · <span className="font-semibold">{fmtINR(amount)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment date">
              <input
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                max={today}
                className={fieldCls}
              />
            </Field>
            <Field label="Payment mode">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className={fieldCls}
              >
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Reference / note (optional)">
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. UPI txn ID, cheque no., last 4 of card"
              className={fieldCls}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink-100">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              : <><CheckCircle2 className="w-3.5 h-3.5" /> Mark paid</>}
          </Button>
        </div>
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