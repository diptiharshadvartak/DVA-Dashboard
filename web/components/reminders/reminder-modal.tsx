'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Send, Link as LinkIcon, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { StudentAvatar } from '@/components/ui/avatar';
import { fmtINR, fmtDate } from '@/lib/utils';
import type { Database } from '@/types/database';

type Student = Database['public']['Tables']['students']['Row'];
type Emi = Database['public']['Tables']['emi_schedule']['Row'];

export function ReminderModal({ open, onClose, studentId, emiId }: {
  open: boolean; onClose: () => void; studentId: string; emiId?: string;
}) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const { toast } = useToast();
  const [student, setStudent] = useState<Student | null>(null);
  const [emi, setEmi] = useState<Emi | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      const [{ data: s }, emiQ] = await Promise.all([
        sb.from('students').select('*').eq('id', studentId).maybeSingle(),
        emiId
          ? sb.from('emi_schedule').select('*').eq('id', emiId).maybeSingle()
          : sb.from('emi_schedule').select('*').eq('student_id', studentId).neq('status', 'paid').order('installment_no').limit(1).maybeSingle(),
      ]);
      if (!cancel) {
        setStudent(s);
        setEmi(emiQ.data ?? null);
      }
    })();
    return () => { cancel = true; };
  }, [open, studentId, emiId, sb]);

  if (!open) return null;

  // Priority: EMI Cashfree link > EMI generic link > Student default link
  const emiCashfreeLink = (emi as any)?.cashfree_link_url ?? '';
  const emiGenericLink = (emi as any)?.payment_link ?? '';
  const studentLink = (student as any)?.payment_link ?? '';
  const paymentLink = (emiCashfreeLink || emiGenericLink || studentLink).trim();
  const hasPaymentLink = !!paymentLink;
  const linkSource: 'cashfree' | 'emi-set' | 'student-default' | 'none' =
    emiCashfreeLink ? 'cashfree' : (emiGenericLink ? 'emi-set' : (studentLink ? 'student-default' : 'none'));

  const message = student && emi
    ? `Hi ${student.first_name ?? 'there'}, your EMI of ${fmtINR(Number(emi.amount))} (${emi.installment_no}/${emi.installments_total}) is due on ${fmtDate(emi.due_date)}.${hasPaymentLink ? `\n\nPay here: ${paymentLink}` : ''}\n— Team DVA`
    : '';

  async function send() {
    if (!student) return;
    setSending(true);
    try {
      const r = await fetch('/api/ghl/trigger-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          emiId: emi?.id ?? null,
          channel: 'whatsapp',
          payload: {
            first_name: student.first_name,
            last_name: student.last_name,
            email: student.email,
            phone: student.mobile,
            emi_amount: emi?.amount,
            payment_link: paymentLink,
            due_date: emi?.due_date,
            installment: emi ? `${emi.installment_no}/${emi.installments_total}` : null,
          },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast('Reminder sent · WhatsApp + Email', 'success');
      onClose();
    } catch (e: any) {
      toast(e.message ?? 'Failed', 'error');
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4">
      <div onClick={onClose} className="absolute inset-0 bg-ink-950/40 transition-opacity duration-200" />
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-[520px] overflow-hidden">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[18px] font-semibold tracking-tight">Send reminder</div>
              <div className="text-[12.5px] text-ink-500 mt-0.5">via GoHighLevel · sends WhatsApp + Email together</div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center"><X className="w-4 h-4" /></button>
          </div>

          {student && (
            <div className="bg-ink-50 rounded-xl p-3.5 flex items-center gap-3 mb-5">
              <StudentAvatar first={student.first_name} last={student.last_name} size={36} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13.5px]">{student.first_name} {student.last_name}</div>
                <div className="text-[12px] text-ink-500">{student.mobile ?? student.email}</div>
              </div>
              {emi && (
                <div className="text-right">
                  <div className="font-mono text-[11.5px] text-ink-500">{emi.installment_no}/{emi.installments_total}</div>
                  <div className="font-semibold text-[14px]">{fmtINR(Number(emi.amount))}</div>
                </div>
              )}
            </div>
          )}

          <Section label="Payment link">
            {hasPaymentLink ? (
              <div className="bg-accent-50/40 border border-accent-200/60 rounded-lg p-3">
                <div className="flex items-center gap-2.5 mb-1">
                  <LinkIcon className="w-4 h-4 text-accent-700 shrink-0" />
                  <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                     className="text-[12.5px] text-accent-700 hover:underline truncate flex-1 min-w-0">
                    {paymentLink}
                  </a>
                  <Link href={`/students?student=${studentId}&tab=payments` as any}
                        className="text-[11px] font-medium text-ink-600 hover:text-ink-900 hover:underline shrink-0">
                    Change
                  </Link>
                </div>
                {linkSource === 'cashfree' && (
                  <div className="text-[10.5px] text-blue-700 font-medium ml-6">✓ Cashfree link for this exact installment</div>
                )}
                {linkSource === 'emi-set' && (
                  <div className="text-[10.5px] text-ink-500 ml-6">Custom link set for this installment</div>
                )}
                {linkSource === 'student-default' && (
                  <div className="text-[10.5px] text-ink-500 ml-6">Using student&apos;s default link (same for all EMIs)</div>
                )}
              </div>
            ) : (
              <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-amber-900 font-medium">No payment link set for this student</div>
                  <div className="text-[11px] text-amber-800 mt-0.5">
                    Reminder will be sent without a payment link. <Link href={`/students?student=${studentId}&tab=payments` as any} className="underline font-medium">Add one</Link> to include it in all future reminders.
                  </div>
                </div>
              </div>
            )}
          </Section>

          <Section label="Preview">
            <div className="bg-emerald-50/30 border border-emerald-100 rounded-xl p-3.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-800">
              {message || <span className="text-ink-400">No EMI on file.</span>}
            </div>
            <div className="text-[11px] text-ink-400 mt-1.5">Same message goes to WhatsApp + Email together</div>
          </Section>

          <div className="flex items-center gap-2 mt-6">
            <button onClick={onClose} className="h-10 px-4 rounded-lg border border-ink-200 text-[13px] font-medium hover:bg-ink-50">Cancel</button>
            <button onClick={send} disabled={sending || !emi}
              className="btn-primary ml-auto h-10 px-5 rounded-lg text-[13px] font-medium flex items-center gap-2 disabled:opacity-50">
              {sending ? 'Sending…' : <>Send reminder <Send className="w-4 h-4" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="text-[11.5px] uppercase tracking-wider font-semibold text-ink-500 mb-2">{label}</div>
      {children}
    </div>
  );
}