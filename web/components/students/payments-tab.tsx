'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IndianRupee, Plus, CheckCircle2, AlertTriangle, Pencil, Link as LinkIcon, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtINR, fmtDate } from '@/lib/utils';
import { ReminderModal } from '@/components/reminders/reminder-modal';
import { EmiSetupModal } from './emi-setup-modal';
import { MarkPaidModal } from './mark-paid-modal';
import { EditPaymentModal } from './edit-payment-modal';
import { ChangePaymentLinkModal } from './change-payment-link-modal';
import { CollectPaymentModal } from './collect-payment-modal';
import { PaymentHistorySection } from './payment-history-section';
import type { Database } from '@/types/database';

type Emi = Database['public']['Tables']['emi_schedule']['Row'];
type StudentSlim = {
  total_fee: number | null;
  down_payment: number | null;
  down_payment_date: string | null;
  payment_link: string | null;
};

export function PaymentsTab({ studentId }: { studentId: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const { toast } = useToast();
  const [rows, setRows] = useState<Emi[]>([]);
  const [student, setStudent] = useState<StudentSlim | null>(null);
  const [reminderEmi, setReminderEmi] = useState<string | null>(null);
  const [payEmi, setPayEmi] = useState<Emi | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [editEmi, setEditEmi] = useState<Emi | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [busyCashfree, setBusyCashfree] = useState<string | null>(null);
  const [busySync, setBusySync] = useState<string | null>(null);
  const [paymentIdsByEmi, setPaymentIdsByEmi] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  // Bumped after every load() so child sections (e.g. Payment History) re-fetch
  // once a sync/mark-paid has changed the underlying data.
  const [refreshKey, setRefreshKey] = useState(0);
  // Auto status-reconcile runs once per student load so it can't loop with load().
  const autoSyncDone = useRef(false);

  function copyLinkToClipboard(link: string) {
    navigator.clipboard.writeText(link).then(() => {
      toast('Link copied to clipboard', 'success');
    }).catch(() => {
      toast('Failed to copy', 'error');
    });
  }

  async function generateCashfreeLink(emiId: string) {
    setBusyCashfree(emiId);
    try {
      const res = await fetch('/api/cashfree/generate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emiId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed');
      toast('Cashfree link generated', 'success');
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Failed to generate Cashfree link', 'error');
    } finally {
      setBusyCashfree(null);
    }
  }

  async function load(): Promise<Emi[]> {
    const [{ data: emi }, { data: stu }, { data: cfEvents }] = await Promise.all([
      sb.from('emi_schedule').select('*').eq('student_id', studentId).order('installment_no'),
      sb.from('students').select('total_fee, down_payment, down_payment_date, payment_link').eq('id', studentId).maybeSingle(),
      sb.from('cashfree_events').select('emi_id, payload').eq('student_id', studentId).eq('event_type', 'payment_success'),
    ]);
    const emiRows = (emi ?? []) as Emi[];
    setRows(emiRows);
    setStudent((stu as any) ?? null);

    // Build payment ID map: emi_id → payment_id
    const idMap: Record<string, string> = {};
    for (const evt of (cfEvents ?? []) as any[]) {
      if (evt.emi_id) {
        const pid = evt.payload?.data?.payment?.cf_payment_id
                 ?? evt.payload?.data?.payment?.payment_id;
        if (pid) idMap[evt.emi_id] = pid.toString();
      }
    }
    setPaymentIdsByEmi(idMap);
    setLoaded(true);
    setRefreshKey((k) => k + 1);
    return emiRows;
  }

  // Reconcile one EMI with Cashfree's live link status (marks paid if PAID there).
  // `silent` skips the toast for the background auto-sync. Returns whether it flipped.
  async function syncCashfreeStatus(emiId: string, silent = false): Promise<boolean> {
    if (!silent) setBusySync(emiId);
    try {
      const res = await fetch('/api/cashfree/sync-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emiId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'Failed');
      if (!silent) {
        if (data.marked_paid) toast('Payment confirmed — marked paid.', 'success');
        else if (data.already_paid) toast('Already marked paid.', 'success');
        else toast(`Cashfree status: ${data.status ?? 'unknown'} — not paid yet.`, 'info');
        await load();
      }
      return !!data.marked_paid;
    } catch (e: any) {
      if (!silent) toast(e.message ?? 'Failed to sync status', 'error');
      return false;
    } finally {
      if (!silent) setBusySync(null);
    }
  }

  // Best-effort background reconcile: for any unpaid EMI that has a Cashfree
  // link, ask Cashfree whether it's been paid. Catches payments completed when
  // the webhook couldn't reach the app. Runs once per student load.
  async function autoSyncCashfree(currentRows: Emi[]) {
    const pending = currentRows.filter(r => r.status !== 'paid' && (r as any).cashfree_link_id);
    if (pending.length === 0) return;
    const results = await Promise.allSettled(pending.map(r => syncCashfreeStatus(r.id, true)));
    const anyPaid = results.some(r => r.status === 'fulfilled' && r.value);
    if (anyPaid) await load();
  }

  useEffect(() => {
    autoSyncDone.current = false;
    let cancelled = false;
    (async () => {
      const emiRows = await load();
      if (cancelled || autoSyncDone.current) return;
      autoSyncDone.current = true;
      await autoSyncCashfree(emiRows);
    })().catch(() => {});
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [studentId, sb]);

  const totalEmi    = rows.reduce((s, r) => s + Number(r.amount), 0);
  const paidEmi     = rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const downPayment = Number(student?.down_payment ?? 0);
  const totalFee    = Number(student?.total_fee ?? (totalEmi + downPayment));
  const totalPaid   = paidEmi + downPayment;
  const outstanding = Math.max(0, totalFee - totalPaid);

  const planTotal = totalEmi + downPayment;
  const mismatch = totalFee > 0 ? totalFee - planTotal : 0;
  // Money-received view (down payment + paid installments) vs the fee. These
  // drive the "fully paid" / "extra collected" banners — they reflect actual
  // cash in, not just how the plan was configured.
  const overpaid  = totalFee > 0 ? totalPaid - totalFee : 0;
  const fullyPaid = totalFee > 0 && totalPaid > 0 && outstanding === 0 && overpaid <= 1;
  const nextInstallmentNo = rows.reduce((m, r) => Math.max(m, Number(r.installment_no) || 0), 0) + 1;
  // Balance already covered by unpaid installments on the plan. "Collect
  // payment" should default to what's NOT yet scheduled, so it doesn't add a
  // redundant installment for money that's already on the plan.
  const scheduledUnpaid = rows.filter(r => r.status !== 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const collectable = Math.max(0, outstanding - scheduledUnpaid);

  // Per-row display + "Extra" flagging.
  //
  // A payment is "Extra" ONLY once the full fee has actually been CLEARED by
  // real money received — i.e. a *paid* installment whose money starts at/after
  // the total fee (down payment + earlier paid installments already cover it).
  // An unpaid installment is never "extra"; it's a pending obligation toward the
  // balance. So while EMIs are still owed, a collected payment shows as a normal
  // numbered installment; it only flips to "Extra" once the fee is paid off.
  // Non-extra rows are numbered against the count of real plan installments so
  // denominators stay consistent (no "4/4" sitting next to "x/3").
  const extraFlags = (() => {
    let cumPaid = downPayment; // down payment counts as money received
    return rows.map((r) => {
      if (r.status !== 'paid') return false;
      const isExtra = totalFee > 0 && cumPaid >= totalFee - 1;
      cumPaid += Number(r.amount);
      return isExtra;
    });
  })();
  const planCount = extraFlags.filter((f) => !f).length;
  const labeledRows = (() => {
    let planIdx = 0;
    return rows.map((r, i) => {
      if (extraFlags[i]) return { row: r, isExtra: true, label: 'Extra' };
      planIdx += 1;
      return { row: r, isExtra: false, label: `${planIdx}/${planCount}` };
    });
  })();

  const labelByEmiId = new Map(labeledRows.map((l) => [l.row.id, l.label] as const));
  // Plan-only EMI counts (exclude extra top-ups) for the KPI subtitles.
  const planPaidCount = labeledRows.filter((l) => !l.isExtra && l.row.status === 'paid').length;
  const planUnpaidCount = labeledRows.filter((l) => !l.isExtra && l.row.status !== 'paid').length;
  const extraCount = rows.length - planCount;

  if (!loaded) return <div className="text-[13px] text-ink-500">Loading…</div>;

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
        <Kpi label="Total fee" value={fmtINR(totalFee)} sub={planCount ? `${planCount} installments + downpayment${extraCount > 0 ? ` · ${extraCount} extra` : ''}` : 'down payment only'} onEdit={() => setSetupOpen(true)} />
        <Kpi label="Down payment" value={fmtINR(downPayment)} sub={student?.down_payment_date ? `paid ${fmtDate(student.down_payment_date)}` : downPayment > 0 ? 'paid' : 'not set'} tone={downPayment > 0 ? 'good' : 'neutral'} onEdit={() => setSetupOpen(true)} />
        <Kpi label="Paid so far" value={fmtINR(totalPaid)} sub={`${planPaidCount} of ${planCount} EMIs paid${extraCount > 0 ? ` + ${extraCount} extra` : ''}`} tone="good" />
        <Kpi label="Outstanding" value={fmtINR(outstanding)} sub={`${planUnpaidCount} EMI${planUnpaidCount === 1 ? '' : 's'} left`} tone={outstanding > 0 ? 'warn' : 'good'} />
      </div>

      {/* Collect a payment toward the balance with an editable amount */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setCollectOpen(true)}>
          <IndianRupee className="w-4 h-4" /> Collect payment
        </Button>
      </div>

      {/* Plan is SHORT of the total fee — a real gap the coach needs to fix. */}
      {mismatch > 1 && (
        <div className="bg-amber-50/70 border border-amber-300 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13.5px] text-amber-900">EMI plan doesn&apos;t match total fee</div>
            <div className="text-[12px] text-amber-800 mt-1 leading-relaxed">
              Total fee is {fmtINR(totalFee)} but the plan covers only {fmtINR(planTotal)} (₹{Math.abs(mismatch).toLocaleString('en-IN')} short).
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

      {/* Fully paid — money received exactly clears the fee. Positive
          confirmation; no action needed. */}
      {fullyPaid && (
        <div className="bg-emerald-50/70 border border-emerald-300 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13.5px] text-emerald-900">Fully paid</div>
            <div className="text-[12px] text-emerald-800 mt-1 leading-relaxed">
              {fmtINR(totalPaid)} received against the total fee of {fmtINR(totalFee)}. Nothing outstanding.
            </div>
          </div>
        </div>
      )}

      {/* Overpaid — more money received than the fee. Not an error: show the
          extra collected instead of the mismatch warning. */}
      {overpaid > 1 && (
        <div className="bg-emerald-50/70 border border-emerald-300 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[13.5px] text-emerald-900">Extra amount added — existing fee is done</div>
            <div className="text-[12px] text-emerald-800 mt-1 leading-relaxed">
              {fmtINR(totalPaid)} received against the total fee of {fmtINR(totalFee)} — ₹{overpaid.toLocaleString('en-IN')} extra.
            </div>
          </div>
        </div>
      )}

      {/* Payment link banner */}
      {student?.payment_link && (
        <div className="bg-white border border-ink-200/70 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-accent-50 text-accent-700 grid place-items-center shrink-0">
            <LinkIcon className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13.5px]">Student default payment link</div>
            <a href={student.payment_link} target="_blank" rel="noopener noreferrer"
               className="text-[11.5px] text-accent-700 hover:underline truncate block">
              {student.payment_link}
            </a>
          </div>
          <button
            onClick={() => copyLinkToClipboard(student.payment_link ?? '')}
            className="text-[11.5px] font-medium text-ink-600 hover:text-ink-900 inline-flex items-center gap-1"
            title="Copy payment link"
          >
            <Copy className="w-3 h-3" /> Copy
          </button>
          <button
            onClick={() => setLinkOpen(true)}
            className="text-[11.5px] font-medium text-accent-700 hover:underline inline-flex items-center gap-1"
            title="Change payment link"
          >
            <Pencil className="w-3 h-3" /> Change
          </button>
        </div>
      )}

      {/* Down payment row */}
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
          <button
            onClick={() => setSetupOpen(true)}
            className="w-7 h-7 rounded-md hover:bg-white grid place-items-center text-emerald-700 hover:text-emerald-900 transition"
            title="Edit down payment"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* EMI rows */}
      {rows.length > 0 ? (
        <div className="bg-white border border-ink-200/70 rounded-xl">
          <div className="px-4 py-2.5 border-b border-ink-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="text-[12px] font-semibold text-ink-700">EMI schedule</div>
              <span className="text-[11px] text-ink-500">
                {planCount} installment{planCount === 1 ? '' : 's'}
                {rows.length - planCount > 0 ? ` · ${rows.length - planCount} extra` : ''}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {!student?.payment_link && (
                <button
                  onClick={() => setLinkOpen(true)}
                  className="text-[11.5px] font-medium text-accent-700 hover:text-accent-900 hover:underline inline-flex items-center gap-1"
                >
                  <LinkIcon className="w-3 h-3" /> Add default link
                </button>
              )}
              <button
                onClick={() => setSetupOpen(true)}
                className="text-[11.5px] font-medium text-accent-700 hover:text-accent-900 hover:underline inline-flex items-center gap-1"
                title="Edit total fee, down payment, or EMI schedule"
              >
                <Pencil className="w-3 h-3" /> Edit plan
              </button>
            </div>
          </div>
          <div className="grid grid-cols-[60px_1fr_120px_140px_220px] gap-3 px-4 py-2 border-b border-ink-100 text-[10.5px] uppercase tracking-wider text-ink-500 font-semibold">
            <div>#</div><div>Amount</div><div>Due date</div><div>Status</div><div className="text-right">Action</div>
          </div>
          {labeledRows.map(({ row: r, isExtra, label }) => (
            <div key={r.id} className="grid grid-cols-[60px_1fr_120px_140px_220px] gap-3 px-4 py-3 items-center border-b border-ink-100 last:border-0 text-[13px]">
              {isExtra ? (
                <span
                  className="inline-flex items-center px-1.5 h-5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold tracking-wide w-fit"
                  title="Collected after the plan was fully covered — extra amount"
                >
                  Extra
                </span>
              ) : (
                <div className="font-mono text-[12px] text-ink-700">{label}</div>
              )}
              <div className="font-semibold">{fmtINR(Number(r.amount))}</div>
              <div className="text-ink-600">{fmtDate(r.due_date)}</div>
              <div><StatusPill status={r.status} /></div>
              <div className="text-right">
                {r.status === 'paid' ? (
                  <div className="flex items-center justify-end gap-2">
                    <div className="text-[11.5px] text-ink-500 leading-tight text-right">
                      <div>Paid {fmtDate(r.paid_date)}</div>
                      {r.payment_mode && (
                        <div className="text-[10.5px] text-emerald-700 font-medium">via {r.payment_mode}</div>
                      )}
                      {paymentIdsByEmi[r.id] && (
                        <div className="text-[10px] text-ink-400 font-mono">ID: {paymentIdsByEmi[r.id].slice(0, 12)}...</div>
                      )}
                    </div>
                    <button
                      onClick={() => setEditEmi(r)}
                      className="w-7 h-7 rounded-md hover:bg-ink-100 grid place-items-center text-ink-500 hover:text-accent-600 transition"
                      title="Edit payment"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    {(r as any).cashfree_link_url ? (
                      <>
                        <a
                          href={(r as any).cashfree_link_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11.5px] font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                          title="Open Cashfree payment link"
                        >
                          <LinkIcon className="w-3 h-3" /> Open
                        </a>
                        <button
                          onClick={() => copyLinkToClipboard((r as any).cashfree_link_url)}
                          className="text-[11.5px] font-medium text-ink-600 hover:text-ink-900 inline-flex items-center gap-1"
                          title="Copy link"
                        >
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => generateCashfreeLink(r.id)}
                        disabled={busyCashfree === r.id}
                        className="text-[11.5px] font-medium text-blue-700 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                        title="Generate Cashfree payment link for this EMI"
                      >
                        <LinkIcon className="w-3 h-3" />
                        {busyCashfree === r.id ? 'Generating…' : 'Get link'}
                      </button>
                    )}
                    {(r as any).cashfree_link_id && (
                      <>
                        <span className="text-ink-300">·</span>
                        <button
                          onClick={() => syncCashfreeStatus(r.id)}
                          disabled={busySync === r.id}
                          className="text-[11.5px] font-medium text-ink-600 hover:text-ink-900 inline-flex items-center gap-1 disabled:opacity-50"
                          title="Check the live Cashfree status and mark paid if the student has already paid"
                        >
                          <RefreshCw className={`w-3 h-3 ${busySync === r.id ? 'animate-spin' : ''}`} />
                          {busySync === r.id ? 'Syncing…' : 'Sync'}
                        </button>
                      </>
                    )}
                    <span className="text-ink-300">·</span>
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
      {linkOpen && (
        <ChangePaymentLinkModal
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          onSaved={load}
          studentId={studentId}
          currentLink={student?.payment_link ?? null}
        />
      )}
      {editEmi && (
        <EditPaymentModal
          open={!!editEmi}
          onClose={() => setEditEmi(null)}
          onSaved={load}
          emiId={editEmi.id}
          installmentLabel={labelByEmiId.get(editEmi.id) ?? `${editEmi.installment_no}/${editEmi.installments_total}`}
          initialAmount={Number(editEmi.amount)}
          initialPaidDate={editEmi.paid_date ?? new Date().toISOString().slice(0, 10)}
          initialMode={(editEmi as any).payment_mode ?? 'UPI'}
          initialReference={(editEmi as any).payment_link ?? ''}
        />
      )}
      {payEmi && (
        <MarkPaidModal
          open={!!payEmi}
          onClose={() => setPayEmi(null)}
          onSaved={load}
          emiId={payEmi.id}
          amount={Number(payEmi.amount)}
          installmentLabel={labelByEmiId.get(payEmi.id) ?? `${payEmi.installment_no}/${payEmi.installments_total}`}
        />
      )}
      {setupOpen && <EmiSetupModal studentId={studentId} onClose={() => setSetupOpen(false)} onSaved={load} />}
      {collectOpen && (
        <CollectPaymentModal
          open={collectOpen}
          onClose={() => setCollectOpen(false)}
          onSaved={load}
          studentId={studentId}
          outstanding={outstanding}
          defaultAmount={collectable}
          nextInstallmentNo={nextInstallmentNo}
        />
      )}

      <PaymentHistorySection studentId={studentId} refreshKey={refreshKey} />
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral', onEdit }: { label: string; value: string; sub?: string; tone?: 'neutral' | 'good' | 'warn'; onEdit?: () => void }) {
  const subCls = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-ink-500';
  return (
    <div className="bg-white border border-ink-200/70 rounded-xl p-4 relative group">
      {onEdit && (
        <button
          onClick={onEdit}
          className="absolute top-2.5 right-2.5 w-6 h-6 rounded-md hover:bg-ink-100 grid place-items-center text-ink-400 hover:text-accent-600 transition opacity-0 group-hover:opacity-100"
          title={`Edit ${label.toLowerCase()}`}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      <div className="text-[11.5px] uppercase tracking-wider text-ink-500 font-semibold">{label}</div>
      <div className="text-[20px] font-semibold tracking-tight mt-1">{value}</div>
      {sub && <div className={`text-[11.5px] ${subCls}`}>{sub}</div>}
    </div>
  );
}