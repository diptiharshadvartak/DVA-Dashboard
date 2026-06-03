import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { istDateString } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ParsedRow = {
  email: string;
  first_name: string;
  last_name: string;
  mobile: string;
  emi_current: number;
  emi_total: number;
  emi_amount: number;
  due_date: string;
  payment_mode: string;
  payment_modes?: string[];
  total_fee: number;
  payment_link?: string | null;
  month_1?: boolean; month_2?: boolean; month_3?: boolean;
  month_4?: boolean; month_5?: boolean; month_6?: boolean;
  is_super_baker_finisher?: boolean;
  is_hall_of_fame?: boolean;
  certificate_issued?: boolean;
  certificate_issued_date?: string | null;
  bbr_attended?: boolean;
  bbr_attended_date?: string | null;
  background?: string | null;
  call_logs?: { date: string | null; comment: string; coach_label: string }[];
  membership?: string | null;
  tags?: string[];
  course_end_date?: string | null;
  course_start_date?: string | null;
  alternate_number?: string | null;
  student_group?: string | null;
  profile_link?: string | null;
  total_fee_override?: number | null;
  downpayment_amount?: number | null;
  downpayment_date?: string | null;
  full_payment_amount?: number | null;
  full_payment_date?: string | null;
  payment_history?: { amount: number; date: string | null }[];
};

// Build optional achievement/progress fields (only include keys that are defined)
function achievementFields(row: ParsedRow): Record<string, any> {
  const f: Record<string, any> = {};
  if (row.month_1 !== undefined) f.month_1 = row.month_1;
  if (row.month_2 !== undefined) f.month_2 = row.month_2;
  if (row.month_3 !== undefined) f.month_3 = row.month_3;
  if (row.month_4 !== undefined) f.month_4 = row.month_4;
  if (row.month_5 !== undefined) f.month_5 = row.month_5;
  if (row.month_6 !== undefined) f.month_6 = row.month_6;
  if (row.is_super_baker_finisher !== undefined) f.is_super_baker_finisher = row.is_super_baker_finisher;
  if (row.is_hall_of_fame !== undefined) f.is_hall_of_fame = row.is_hall_of_fame;
  if (row.certificate_issued !== undefined) f.certificate_issued = row.certificate_issued;
  if (row.certificate_issued_date) f.certificate_issued_date = row.certificate_issued_date;
  if (row.bbr_attended !== undefined) f.bbr_attended = row.bbr_attended;
  if (row.bbr_attended_date) f.bbr_attended_date = row.bbr_attended_date;
  if (row.background) f.background = row.background;
  if (row.membership !== undefined && row.membership !== null) f.membership = row.membership;
  if (row.tags !== undefined) f.tags = row.tags;
  if (row.course_end_date) f.course_end_date = row.course_end_date;
  if (row.course_start_date) f.course_start_date = row.course_start_date;
  if (row.alternate_number !== undefined) f.alternate_number = row.alternate_number;
  if (row.student_group !== undefined) f.student_group = row.student_group;
  if (row.profile_link !== undefined) f.profile_link = row.profile_link;
  // DB columns are down_payment / down_payment_date (see migration 0006); the
  // parsed field is downpayment_amount. Writing the wrong name silently failed
  // the insert for every row that has a down payment.
  if (row.downpayment_amount !== null && row.downpayment_amount !== undefined) f.down_payment = row.downpayment_amount;
  if (row.downpayment_date) f.down_payment_date = row.downpayment_date;
  if (row.full_payment_amount !== null && row.full_payment_amount !== undefined) f.full_payment_amount = row.full_payment_amount;
  if (row.full_payment_date) f.full_payment_date = row.full_payment_date;
  if (row.total_fee_override !== null && row.total_fee_override !== undefined) f.total_fee = row.total_fee_override;
  return f;
}

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if ((profile as any)?.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 });
  }

  const { rows }: { rows: ParsedRow[] } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'No rows provided' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const today = istDateString();

  let importedStudents = 0;
  let createdEmis = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      // Find or create student
      const { data: existing } = await admin
        .from('students')
        .select('id, tags')
        .eq('email', row.email)
        .maybeSingle();

      let studentId: string;
      if (existing) {
        // Update student info but PRESERVE existing tags
        await admin.from('students').update({
          first_name: row.first_name,
          last_name: row.last_name || null,
          mobile: row.mobile || null,
          total_fee: row.total_fee,
          membership: 'Diamond',
          ...achievementFields(row),
        } as any).eq('id', (existing as any).id);
        studentId = (existing as any).id;
      } else {
        const { data: created, error } = await admin
          .from('students')
          .insert({
            email: row.email,
            first_name: row.first_name,
            last_name: row.last_name || null,
            mobile: row.mobile || null,
            total_fee: row.total_fee,
            membership: 'Diamond',
            ...achievementFields(row),
          } as any)
          .select('id')
          .single();
        if (error) throw error;
        studentId = (created as any).id;
      }

      // Import call logs (duplicate-safe)
      if (row.call_logs && row.call_logs.length > 0) {
        for (const call of row.call_logs) {
          const { data: dupe } = await admin
            .from('call_logs')
            .select('id')
            .eq('student_id', studentId)
            .eq('comment', `[${call.coach_label}] ${call.comment}`)
            .maybeSingle();
          if (dupe) continue;
          const { error: clErr } = await admin.from('call_logs').insert({
            student_id: studentId,
            coach_id: user.id,
            comment: `[${call.coach_label}] ${call.comment}`,
            outcome: 'connected',
            created_at: call.date ? new Date(call.date).toISOString() : new Date().toISOString(),
          } as any);
          if (clErr) errors.push(`${row.email}: a call log was not saved — ${clErr.message}`);
        }
      }

      // Weekly checkpoints: the Progress tab is week-driven (4 weeks per month)
      // and derives month completion from weekly_checkpoints. The sheet only
      // marks progress month-wise (Month 1..6), so without materializing the
      // weeks the months were saved on the student but the UI read 0/6.
      // Create the 4 weeks of each completed month as done. Idempotent on
      // re-import (upsert keyed on student_id,week_no).
      const monthFlags = [row.month_1, row.month_2, row.month_3, row.month_4, row.month_5, row.month_6];
      const weekRows: any[] = [];
      monthFlags.forEach((done, idx) => {
        if (done) {
          for (let w = 1; w <= 4; w++) {
            weekRows.push({ student_id: studentId, week_no: idx * 4 + w, completed: true });
          }
        }
      });
      if (weekRows.length > 0) {
        const { error: wkErr } = await admin.from('weekly_checkpoints').upsert(weekRows as any, { onConflict: 'student_id,week_no' });
        if (wkErr) errors.push(`${row.email}: progress weeks not saved — ${wkErr.message}`);
      }

      // Determine whether to use EXPLICIT payment history or fall back to EMI=X/Y synthesis
      const hasExplicitPayments =
        (row.full_payment_amount && row.full_payment_amount > 0) ||
        !!(row.downpayment_amount && row.downpayment_amount > 0) ||
        !!(row.payment_history && row.payment_history.length > 0);

      // EMI Tracker import REPLACES EMI plan (intentional)
      await admin.from('emi_schedule').delete().eq('student_id', studentId);

      // PATH A: explicit payments WITHOUT an EMI ratio (a full payment, or a
      // down/itemized payment with no X/Y plan) → record the paid amounts
      // directly. When an EMI ratio IS present we fall through to PATH B, which
      // builds the full installment plan for the balance after the down payment.
      if (hasExplicitPayments && !(row.emi_total > 0)) {
        const fallbackDate = new Date().toISOString().substring(0, 10);

        // Collect the actual payments to record as paid installments. The down
        // payment is deliberately NOT one of them: it lives on the student
        // record (students.down_payment) and the Payments/Profile views add it
        // on top of the EMI total — recording it here as well would
        // double-count it.
        const isFullPayment = !!(row.full_payment_amount && row.full_payment_amount > 0);
        const payments: { amount: number; date: string; mode: string }[] = [];
        if (isFullPayment) {
          payments.push({
            amount: row.full_payment_amount as number,
            date: row.full_payment_date || fallbackDate,
            mode: row.payment_mode || 'Full Payment',
          });
        } else {
          (row.payment_history || []).forEach((pay, i) => {
            if (!(pay.amount > 0)) return;
            payments.push({
              amount: pay.amount,
              date: pay.date || fallbackDate,
              mode: modeAt(row, i),
            });
          });
        }

        // If down payment + recorded payments fall short of the total fee, the
        // student still owes the balance. Generate UPCOMING installments for
        // that balance, sized to the EMI they've been paying (the most common
        // past payment amount) and continuing the monthly cadence from the last
        // payment. This makes the plan add up to the total fee and gives the
        // coach payable installments instead of just an "X short" warning.
        const downForPlan = (row.downpayment_amount && row.downpayment_amount > 0) ? row.downpayment_amount : 0;
        const paidSum = payments.reduce((s, p) => s + p.amount, 0);
        const remaining = (row.total_fee && row.total_fee > 0)
          ? row.total_fee - downForPlan - paidSum
          : 0;

        const upcoming: { amount: number; date: string }[] = [];
        if (!isFullPayment && remaining > 0 && payments.length > 0) {
          const emiSize = modeAmount(payments.map((p) => p.amount));
          if (emiSize > 0) {
            const n = Math.ceil(remaining / emiSize);
            const lastDate = payments[payments.length - 1].date;
            for (let i = 1; i <= n; i++) {
              // Last installment absorbs the remainder so the plan sums exactly.
              const amt = i < n ? emiSize : remaining - emiSize * (n - 1);
              upcoming.push({ amount: amt, date: addMonths(lastDate, i) });
            }
          }
        }

        // installments_total is NOT NULL (and must be > 0) in the schema, so it
        // has to be set on every row — omitting it made the whole insert fail
        // silently, dropping every payment.
        const totalCount = payments.length + upcoming.length;
        const explicitRows: any[] = payments.map((p, idx) => ({
          student_id: studentId,
          installment_no: idx + 1,
          installments_total: totalCount,
          amount: p.amount,
          due_date: p.date,
          reminder_date: p.date,
          status: 'paid',
          paid_date: p.date,
          payment_mode: p.mode,
        }));
        upcoming.forEach((u, idx) => {
          const status = u.date < today ? 'overdue' : u.date === today ? 'due_soon' : 'upcoming';
          explicitRows.push({
            student_id: studentId,
            installment_no: payments.length + idx + 1,
            installments_total: totalCount,
            amount: u.amount,
            due_date: u.date,
            reminder_date: subDays(u.date, 2),
            status,
            paid_date: null,
            payment_mode: null,
          });
        });

        if (explicitRows.length > 0) {
          const { error: exErr } = await admin.from('emi_schedule').insert(explicitRows as any);
          if (exErr) throw exErr;
        }
        importedStudents++;
        createdEmis += explicitRows.length;
        continue;
      }

      // PATH B: build the full EMI plan for the balance after the down payment.
      // Chosen model: down payment + all installments === total fee. Paid
      // installments use their actual amount when the sheet provides one (see
      // below); any remaining balance is split equally across the unpaid
      // installments. The sheet's "EMI amount" column is intentionally not used
      // here. The final installment absorbs any rounding remainder so the sum
      // is exact.
      const downForPlan = (row.downpayment_amount && row.downpayment_amount > 0) ? row.downpayment_amount : 0;
      const planTotal = (row.total_fee && row.total_fee > 0)
        ? row.total_fee
        // Guard against undefined emi_amount → NaN plan (legacy EMI-ratio path).
        : ((Number(row.emi_amount) || 0) * row.emi_total + downForPlan);
      const balance = Math.max(0, planTotal - downForPlan);

      // When the sheet lists the ACTUAL amount paid for each installment
      // (the "Payment N" columns → payment_history), honor those amounts for
      // the paid installments instead of synthesizing an equal split. The
      // remaining (unpaid) installments share whatever balance is left. This
      // makes "Paid so far"/"Outstanding" reflect real money received — e.g.
      // a down payment plus two lump payments of 65k + 100k that already cover
      // the full fee, rather than 2 synthetic 27.5k installments.
      const paidAmounts = (row.payment_history || [])
        .slice(0, row.emi_current)
        .map((p) => p.amount)
        .filter((a) => a > 0);
      const usingExplicitPaid = paidAmounts.length > 0;
      const sumPaidExplicit = paidAmounts.reduce((s, a) => s + a, 0);

      const splitCount = usingExplicitPaid ? Math.max(0, row.emi_total - row.emi_current) : row.emi_total;
      const splitBalance = usingExplicitPaid ? Math.max(0, balance - sumPaidExplicit) : balance;
      const baseAmount = splitCount > 0 ? Math.floor(splitBalance / splitCount) : 0;

      const emiRows = [];
      for (let i = 1; i <= row.emi_total; i++) {
        const offsetMonths = i - (row.emi_current + 1);
        const instDate = addMonths(row.due_date, offsetMonths);
        const reminderDate = subDays(instDate, 2);

        let status: string;
        let paidDate: string | null = null;
        let paymentMode: string | null = null;

        if (i <= row.emi_current) {
          status = 'paid';
          paidDate = row.payment_history?.[i - 1]?.date || instDate;
          paymentMode = modeAt(row, i - 1);
        } else if (instDate < today) {
          status = 'overdue';
        } else if (instDate === today) {
          status = 'due_soon';
        } else {
          status = 'upcoming';
        }

        // Paid installment with an explicit amount → use it as-is.
        // Otherwise split the (remaining) balance; the final installment
        // absorbs any rounding remainder so the plan sums exactly.
        let amount: number;
        if (usingExplicitPaid && i <= row.emi_current) {
          amount = paidAmounts[i - 1] ?? baseAmount;
        } else if (i === row.emi_total) {
          amount = splitBalance - baseAmount * (splitCount - 1);
        } else {
          amount = baseAmount;
        }

        emiRows.push({
          student_id: studentId,
          installment_no: i,
          installments_total: row.emi_total,
          amount,
          due_date: instDate,
          reminder_date: reminderDate,
          status,
          paid_date: paidDate,
          payment_mode: paymentMode,
        });
      }

      const { error: emiError } = await admin.from('emi_schedule').insert(emiRows as any);
      if (emiError) throw emiError;

      importedStudents++;
      createdEmis += emiRows.length;
    } catch (e: any) {
      errors.push(`${row.email}: ${e.message ?? 'unknown error'}`);
    }
  }

  return NextResponse.json({
    ok: true,
    imported: importedStudents,
    emis: createdEmis,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// Mode for the Nth payment (0-based). When the sheet lists a mode per payment
// ("UPI, Credit Card, NEFT") use the matching one; if there are fewer modes
// than payments the last one carries forward; with no list, fall back to the
// single payment_mode.
function modeAt(row: ParsedRow, idx: number): string {
  const list = row.payment_modes;
  if (list && list.length > 0) return list[Math.min(idx, list.length - 1)];
  return row.payment_mode || 'Payment';
}

// Most common amount in a list — used to infer the recurring EMI size from the
// payments already made. On a count tie the more recent amount wins.
function modeAmount(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (let i = amounts.length - 1; i >= 0; i--) {
    const a = amounts[i];
    const c = counts.get(a) ?? 0;
    if (c > bestCount) { bestCount = c; best = a; }
  }
  return best;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function subDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}