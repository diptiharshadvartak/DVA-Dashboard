// Shared utility helpers — class names, date / money formatters, status helpers.

export function cn(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter(Boolean).join(' ');
}

export function fmtINR(n: number): string {
  if (Number.isNaN(n)) return '₹0';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function daysFromNow(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86400000);
}

export function studentStatusFromEnd(end: string | null | undefined): 'active' | 'expiring' | 'expired' {
  if (!end) return 'active';
  const days = daysFromNow(end);
  if (days === null) return 'active';
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Normalize a phone number to E.164 format (e.g. "+917993499776") so GHL /
// WhatsApp can deliver to it. Indian numbers are the default since DVA's
// audience is in India.
//
// Examples:
//   7993499776          → +917993499776
//   07993499776         → +917993499776  (strips leading 0)
//   917993499776        → +917993499776  (adds +)
//   +91 7993 499776     → +917993499776  (strips spaces)
//   (+91) 7993-499776   → +917993499776  (strips parens, dashes)
//   +14155551212        → +14155551212   (foreign number kept as-is)
//
// If the input can't be parsed, returns null so the caller can skip it.
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode = '91'
): string | null {
  if (!raw) return null;
  // Strip everything except digits and a possibly-leading plus.
  let s = String(raw).trim();
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;

  // If the original had a leading +, trust the country code that follows it.
  if (hasPlus) {
    return '+' + s;
  }

  // Strip a leading 0 (common in Indian local-dial format like 09876...).
  if (s.startsWith('0')) s = s.slice(1);

  // If it already starts with the country code and total length looks right,
  // just prepend the + sign.
  if (s.startsWith(defaultCountryCode) && s.length >= 11) {
    return '+' + s;
  }

  // 10-digit Indian mobile → prepend +91.
  if (s.length === 10) {
    return '+' + defaultCountryCode + s;
  }

  // Anything else: best-effort prepend +.
  return '+' + s;
}

// Current calendar date in IST (UTC+5:30) as YYYY-MM-DD. The app's domain is
// India; computing "today" with new Date().toISOString() uses UTC, which is the
// previous calendar day between 18:30–24:00 IST — causing date-boundary
// off-by-one bugs in EMI statuses, paid dates, and cron sweeps.
export function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

// Split an array into fixed-size chunks. Used to keep PostgREST .in(...) lists
// small — Supabase encodes them into the request URL and a few hundred ids
// overflow the URL length limit and make the whole request fail.
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Fetch every row from a PostgREST select, paging past the default 1000-row
// cap. `makeQuery(from, to)` must apply a STABLE order (e.g. .order('id')) and
// .range(from, to) so paging can't skip or duplicate rows.
export async function selectAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await makeQuery(from, from + 999);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
// Achievement labels shown as tags. Computed from achievement fields so they
// always stay in sync with the student's actual achievement state.
export function achievementTags(s: {
  is_super_baker_finisher?: boolean | null;
  is_hall_of_fame?: boolean | null;
  certificate_issued?: boolean | null;
  bbr_attended?: boolean | null;
}): string[] {
  const tags: string[] = [];
  if (s.is_super_baker_finisher) tags.push('🏆 Super Baker');
  if (s.is_hall_of_fame) tags.push('⭐ Hall of Fame');
  if (s.certificate_issued) tags.push('📜 Certificate');
  if (s.bbr_attended) tags.push('📅 BBR');
  return tags;
}