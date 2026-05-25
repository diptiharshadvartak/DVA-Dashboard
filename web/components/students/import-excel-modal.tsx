'use client';

import { useRef, useState } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle2, X, AlertTriangle, Download } from 'lucide-react';
import { useToast } from '@/components/shell/toast-region';

// Types of rows we can parse
type EmiRow = {
  type: 'emi';
  email: string;
  first_name: string;
  last_name: string;
  mobile: string;
  emi_current: number;
  emi_total: number;
  emi_amount: number;
  due_date: string;
  payment_mode: string;
  total_fee: number;
  payment_link: string | null;
  // Optional achievement + progress columns (if present in EMI sheet)
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
};

type MasterRow = {
  type: 'master';
  email: string;
  first_name: string;
  last_name: string;
  mobile: string;
  membership: string;
  tags: string[];
  background: string;
  month_1: boolean;
  month_2: boolean;
  month_3: boolean;
  month_4: boolean;
  month_5: boolean;
  month_6: boolean;
  is_super_baker_finisher: boolean;
  is_hall_of_fame: boolean;
  certificate_issued: boolean;
  certificate_issued_date: string | null;
  bbr_attended: boolean;
  bbr_attended_date: string | null;
  call_logs: { date: string | null; comment: string; coach_label: string }[];
  course_end_date?: string | null;
  course_start_date?: string | null;
};

type DetectedType = 'emi' | 'master' | 'unknown';

export function ImportExcelModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [emiRows, setEmiRows] = useState<EmiRow[]>([]);
  const [masterRows, setMasterRows] = useState<MasterRow[]>([]);
  const [detected, setDetected] = useState<DetectedType>('unknown');
  const [extras, setExtras] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; updated: number; emis: number } | null>(null);
  const [fileName, setFileName] = useState<string>('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setEmiRows([]);
    setMasterRows([]);
    setErrors([]);
    setDone(null);
    setExtras([]);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });

      if (json.length === 0) {
        setErrors(['File is empty']);
        return;
      }

      // Auto-detect file type by columns
      const columns = Object.keys(json[0]);
      const type = detectFileType(columns);
      setDetected(type);

      // Detect what EXTRA data is present (beyond core payment/profile)
      const cols = columns.map(x => x.toLowerCase());
      const found: string[] = [];
      if (['month 1','month 2','month 3'].some(m => cols.includes(m))) found.push('Course progress (Month 1-6)');
      if (cols.some(x => x === 'sbf' || x.includes('super baker'))) found.push('Super Baker');
      if (cols.some(x => x.includes('hall of fame') || x === 'hof')) found.push('Hall of Fame');
      if (cols.some(x => x.includes('certificate') || x === 'cert')) found.push('Certificate');
      if (cols.some(x => x === 'bbr2' || x === 'bbr')) found.push('BBR attendance');
      if (cols.some(x => x.includes('remark') || x.includes('comment') || x.includes('background'))) found.push('Comments');
      if (cols.some(x => x.includes('call date') || x.includes('call remark'))) found.push('Call logs');
      setExtras(found);

      if (type === 'unknown') {
        setErrors([
          `Couldn't detect file type. Expected columns:`,
          `EMI Tracker: Email Id, Name, Mobile Number, Due Date, EMI amount, EMI`,
          `Master Sheet: Email, First Name, Mobile Number, Membership, Month 1-6`,
        ]);
        return;
      }

      // Parse based on detected type
      const parsedEmi: EmiRow[] = [];
      const parsedMaster: MasterRow[] = [];
      const errs: string[] = [];

      json.forEach((row, idx) => {
        const rowNum = idx + 2;
        // Skip non-data rows: notes, legends, empty rows.
        // A real data row MUST have a valid email (contains "@") in the email column.
        const emailVal = (row['Email Id'] || row['Email'] || row['email'] || '').toString().trim();
        if (!emailVal.includes('@')) {
          return;  // silently skip — this is a note/legend/empty row, not data
        }
        try {
          if (type === 'emi') {
            const parsed = parseEmiRow(row, rowNum);
            if ('error' in parsed) errs.push(parsed.error);
            else parsedEmi.push(parsed);
          } else {
            const parsed = parseMasterRow(row, rowNum);
            if ('error' in parsed) errs.push(parsed.error);
            else parsedMaster.push(parsed);
          }
        } catch (e: any) {
          errs.push(`Row ${rowNum}: ${e.message}`);
        }
      });

      setEmiRows(parsedEmi);
      setMasterRows(parsedMaster);
      setErrors(errs);
    } catch (e: any) {
      toast(`Failed to read file: ${e.message}`, 'error');
    }
  }

  async function commit() {
    const rows = detected === 'emi' ? emiRows : masterRows;
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const endpoint = detected === 'emi' 
        ? '/api/students/import-emi-tracker' 
        : '/api/students/import-master-sheet';
      
      let inserted = 0, updated = 0, emis = 0;
      // Process in chunks
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? 'Import failed');
        inserted += data.inserted ?? data.imported ?? 0;
        updated += data.updated ?? 0;
        emis += data.emis ?? 0;
      }
      setDone({ inserted, updated, emis });
      toast(
        detected === 'emi'
          ? `Imported ${inserted} students with ${emis} EMI rows`
          : `Imported: ${inserted} new + ${updated} updated`,
        'success'
      );
      onDone();
    } catch (e: any) {
      toast(e.message ?? 'Import failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  const rows = detected === 'emi' ? emiRows : masterRows;
  const totalRows = rows.length;

  // Generate + download a sample CSV template with the exact columns the importer expects
  function downloadSample() {
    const headers = [
      'Email Id','Name','Surname','Mobile Number','Membership','Tags','Course Start Date','Course End Date',
      'Due Date','EMI amount','EMI','Payment Mode',
      'Month 1','Month 2','Month 3','Month 4','Month 5','Month 6',
      'SBF','Hall of Fame','Certificate','Certificate Date','BBR2','BBR Date',
      'Remarks','Call Date','Call Remarks',
    ];
    const rows = [
      ['anjali@gmail.com','Anjali','Sharma','9876543210','Diamond','S','01 Jan 2025','30 Jun 2025','15 Feb 2027','12222','15/15','Card','TRUE','TRUE','TRUE','TRUE','TRUE','TRUE','TRUE','TRUE','TRUE','20 May 2026','BBR2','18 May 2026','Graduated. Excellent baker.','15 May 2026','Final review - completed everything'],
      ['rohan@gmail.com','Rohan','Verma','9123456789','Diamond','SDC','15 Feb 2025','15 Aug 2025','20 Mar 2026','10000','3/6','NEFT','TRUE','TRUE','TRUE','TRUE','TRUE','FALSE','FALSE','FALSE','FALSE','','BBR-ABSENT','','On track, missed BBR.','10 May 2026','Discussed month 6 plan'],
      ['meera@gmail.com','Meera','Iyer','9988776655','Diamond','J','10 Apr 2025','10 Oct 2025','15 Apr 2026','5000','1/9','UPI','TRUE','FALSE','FALSE','FALSE','FALSE','FALSE','FALSE','FALSE','FALSE','','','','Just started.','01 Apr 2026','Onboarding call, enthusiastic'],
    ];
    const escape = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [headers, ...rows].map((r) => r.map((c) => escape(String(c))).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DVA_Student_Import_Sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-4">
      <div onClick={onClose} className="absolute inset-0 bg-ink-950/40" />
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-[640px] max-h-[90vh] overflow-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[18px] font-semibold tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                Import Excel
              </div>
              <div className="text-[12.5px] text-ink-500 mt-0.5">
                Auto-detects EMI Tracker or Master Sheet format
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full h-24 rounded-lg border-2 border-dashed border-ink-200 hover:border-blue-400 hover:bg-blue-50/30 flex flex-col items-center justify-center gap-1 text-[13px] text-ink-600"
            >
              <UploadCloud className="w-6 h-6 text-ink-400" />
              <div>{fileName ? <span className="font-medium">{fileName}</span> : 'Click to choose Excel file'}</div>
              <div className="text-[11px] text-ink-400">.xlsx, .xls, or .csv</div>
            </button>

            <div className="flex items-center justify-center gap-1.5 text-[12px] text-ink-500">
              <Download className="w-3.5 h-3.5" />
              <span>First time?</span>
              <button onClick={downloadSample} className="text-blue-600 hover:text-blue-700 font-medium underline underline-offset-2">
                Download sample CSV
              </button>
              <span>to see the format.</span>
            </div>

            {/* Detection result */}
            {fileName && detected !== 'unknown' && (
              <div className={`rounded-lg border p-3 text-[12px] ${
                detected === 'emi' 
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900' 
                  : 'border-blue-200 bg-blue-50 text-blue-900'
              }`}>
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Detected: {detected === 'emi' ? 'EMI Tracker' : 'Master Sheet'}
                </div>
                <div className="text-[11.5px]">
                  {detected === 'emi' 
                    ? 'Will create EMI plans + mark past installments as paid'
                    : 'Will update profile + monthly progress (won\'t touch EMIs)'}
                </div>
                {extras.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-current/10">
                    <div className="text-[11px] font-medium mb-1">Also importing:</div>
                    <div className="flex flex-wrap gap-1">
                      {extras.map((e, i) => (
                        <span key={i} className="text-[10.5px] px-1.5 py-0.5 rounded bg-white/60 border border-current/20">
                          ✓ {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {fileName && detected === 'unknown' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-1">Couldn&apos;t detect file format</div>
                  <div className="text-[11.5px]">Make sure the file has either EMI columns or Month 1-6 columns.</div>
                </div>
              </div>
            )}

            {errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800 space-y-0.5">
                <div className="font-semibold mb-1">⚠ {errors.length} row(s) will be skipped (rest will import fine):</div>
                {errors.slice(0, 5).map((e, i) => <div key={i}>• {e}</div>)}
                {errors.length > 5 && <div>…and {errors.length - 5} more.</div>}
              </div>
            )}

            {/* EMI preview */}
            {detected === 'emi' && emiRows.length > 0 && !done && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="grid grid-cols-2 gap-3 text-[12px] text-ink-700">
                  <Stat label="Students" value={emiRows.length} />
                  <Stat label="Total EMIs" value={emiRows.reduce((s,r) => s + r.emi_total, 0)} />
                  <Stat label="Already Paid" value={emiRows.reduce((s,r) => s + r.emi_current, 0)} tone="emerald" />
                  <Stat label="Total Fees" value={`₹${emiRows.reduce((s,r) => s + r.total_fee, 0).toLocaleString('en-IN')}`} />
                </div>
              </div>
            )}

            {/* Master preview */}
            {detected === 'master' && masterRows.length > 0 && !done && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                <div className="grid grid-cols-2 gap-3 text-[12px] text-ink-700">
                  <Stat label="Students" value={masterRows.length} />
                  <Stat 
                    label="With progress" 
                    value={masterRows.filter(r => r.month_1||r.month_2||r.month_3||r.month_4||r.month_5||r.month_6).length} 
                  />
                  <Stat 
                    label="Months marked" 
                    value={masterRows.reduce((s,r) => s + (r.month_1?1:0)+(r.month_2?1:0)+(r.month_3?1:0)+(r.month_4?1:0)+(r.month_5?1:0)+(r.month_6?1:0), 0)} 
                  />
                  <Stat 
                    label="Weeks (auto-marked)" 
                    value={masterRows.reduce((s,r) => s + (r.month_1?1:0)+(r.month_2?1:0)+(r.month_3?1:0)+(r.month_4?1:0)+(r.month_5?1:0)+(r.month_6?1:0), 0) * 4} 
                    tone="emerald" 
                  />
                </div>
              </div>
            )}

            {done && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 font-semibold text-emerald-900 text-[14px]">
                  <CheckCircle2 className="w-5 h-5" />
                  Import successful!
                </div>
                <div className="text-[12.5px] text-emerald-800 mt-2 leading-relaxed">
                  {detected === 'emi' ? (
                    <>✅ {done.inserted} students imported with {done.emis} EMI rows</>
                  ) : (
                    <>✅ {done.inserted} new + {done.updated} updated students<br />
                       ✅ Progress + weekly checkpoints synced</>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button onClick={onClose} className="h-10 px-4 rounded-lg border border-ink-200 text-[13px] font-medium hover:bg-ink-50">
                {done ? 'Close' : 'Cancel'}
              </button>
              {totalRows > 0 && !done && detected !== 'unknown' && (
                <button
                  onClick={commit}
                  disabled={busy}
                  className={`ml-auto h-10 px-5 rounded-lg text-white text-[13px] font-medium disabled:opacity-50 flex items-center gap-2 ${
                    detected === 'emi' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {busy ? 'Importing…' : <>Import {totalRows} students</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: 'emerald' }) {
  return (
    <div>
      <div className="text-[11px] text-ink-500 uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-[16px] font-semibold mt-0.5 ${tone === 'emerald' ? 'text-emerald-700' : ''}`}>{value}</div>
    </div>
  );
}

function detectFileType(columns: string[]): DetectedType {
  const normalized = columns.map(c => c.toLowerCase());
  const hasEmiCols = normalized.some(c => c.includes('emi amount')) && 
                     normalized.some(c => c === 'emi' || c.includes('emi '));
  const hasMonthCols = ['month 1', 'month 2', 'month 3'].every(m => 
    normalized.some(c => c === m)
  );
  
  if (hasEmiCols) return 'emi';
  if (hasMonthCols) return 'master';
  return 'unknown';
}

function parseEmiRow(row: any, rowNum: number): EmiRow | { error: string } {
  const email = (row['Email Id'] || row['email'] || '').toString().trim();
  const name = (row['Name'] || row['first_name'] || '').toString().trim();
  const mobile = (row['Mobile Number'] || row['mobile'] || '').toString().trim();
  const emiStr = (row['EMI'] || '').toString().trim();
  const amount = parseAmount(row['EMI amount'] || row['amount']);
  const dueRaw = row['Due Date'] || row['due_date'];
  
  if (!email) return { error: `Row ${rowNum}: missing email` };
  if (!name) return { error: `Row ${rowNum}: missing name` };
  if (!amount) return { error: `Row ${rowNum}: invalid amount` };
  if (!dueRaw) return { error: `Row ${rowNum}: missing due date` };
  
  const emiMatch = emiStr.match(/(\d+)\s*\/\s*(\d+)/);
  if (!emiMatch) return { error: `Row ${rowNum}: invalid EMI format "${emiStr}"` };
  
  const dueDate = parseDate(dueRaw);
  if (!dueDate) return { error: `Row ${rowNum}: invalid due date "${dueRaw}"` };

  const current = parseInt(emiMatch[1]);
  const total = parseInt(emiMatch[2]);
  return {
    type: 'emi',
    email: email.toLowerCase(),
    first_name: name,
    last_name: (row['Surname'] || row['last_name'] || '').toString().trim(),
    mobile: cleanPhone(mobile),
    emi_current: current,
    emi_total: total,
    emi_amount: amount,
    due_date: dueDate,
    payment_mode: normalizeMode(row['Payment Mode'] || row['Mode'] || row['payment_mode'] || row['mode'] || row['Unnamed: 8']),
    total_fee: amount * total,
    payment_link: (row['Payment Link'] || row['payment_link'] || row['Unnamed: 9'] || '').toString().trim() || null,
    // Achievement + progress columns (optional — only used if present in sheet)
    month_1: hasMonthCol(row, 1) ? parseBool(row['Month 1'] || row['month_1']) : undefined,
    month_2: hasMonthCol(row, 2) ? parseBool(row['Month 2'] || row['month_2']) : undefined,
    month_3: hasMonthCol(row, 3) ? parseBool(row['Month 3'] || row['month_3']) : undefined,
    month_4: hasMonthCol(row, 4) ? parseBool(row['Month 4'] || row['month_4']) : undefined,
    month_5: hasMonthCol(row, 5) ? parseBool(row['Month 5'] || row['month_5']) : undefined,
    month_6: hasMonthCol(row, 6) ? parseBool(row['Month 6'] || row['month_6']) : undefined,
    is_super_baker_finisher: ('SBF' in row || 'Super Baker' in row) ? parseBool(row['SBF'] || row['Super Baker']) : undefined,
    is_hall_of_fame: ('Hall of Fame' in row || 'HOF' in row) ? parseBool(row['Hall of Fame'] || row['HOF']) : undefined,
    certificate_issued: ('Certificate' in row || 'Cert' in row) ? parseBool(row['Certificate'] || row['Cert']) : undefined,
    certificate_issued_date: parseDate(row['Certificate Date'] || row['Cert Date']),
    bbr_attended: ('BBR2' in row || 'BBR' in row) ? parseBBR(row['BBR2'] || row['BBR']) : undefined,
    bbr_attended_date: parseDate(row['BBR Date']),
    background: emiComments(row),
    call_logs: emiCallLogs(row),
    membership: ('Membership' in row) ? ((row['Membership'] || '').toString().trim() || null) : undefined,
    tags: ('Tags' in row || 'tags' in row) ? parseTags(row['Tags'] || row['tags']) : undefined,
    course_end_date: parseDate(row['Course End Date'] || row['course_end_date']),
    course_start_date: parseDate(row['Course Start Date'] || row['course_start_date']),
  };
}

function parseMasterRow(row: any, rowNum: number): MasterRow | { error: string } {
  const email = (row['Email'] || row['email'] || '').toString().trim();
  if (!email) return { error: `Row ${rowNum}: missing email` };

  const firstName = (row['First Name'] || row['first_name'] || row['Name'] || '').toString().trim();
  if (!firstName) return { error: `Row ${rowNum}: missing first name` };

  const commentParts: string[] = [];
  ['Remarks', 'FM Comments', 'DV Comments', 'AK Comments', 'FM Comments.1', 'AK Comments.1', 'FM Comments.2', 'Call Remarks', 'Background'].forEach(col => {
    const v = row[col];
    if (v && v.toString().trim()) {
      commentParts.push(`[${col}]: ${v.toString().trim()}`);
    }
  });

  // Parse call log entries: pair each Call Date column with its comment column
  const callLogs: { date: string | null; comment: string; coach_label: string }[] = [];
  const callPairs = [
    { dateCol: 'Call Date',   commentCol: 'DV Comments',   coach: 'DV' },
    { dateCol: 'Call Date.1', commentCol: 'AK Comments',   coach: 'AK' },
    { dateCol: 'Call Date.2', commentCol: 'FM Comments.1', coach: 'FM' },
    { dateCol: 'Call Date.3', commentCol: 'AK Comments.1', coach: 'AK' },
  ];
  for (const pair of callPairs) {
    const comment = row[pair.commentCol];
    const date = row[pair.dateCol];
    if (comment && comment.toString().trim()) {
      callLogs.push({
        date: parseDate(date),
        comment: comment.toString().trim(),
        coach_label: pair.coach,
      });
    }
  }

  return {
    type: 'master',
    email: email.toLowerCase(),
    first_name: firstName,
    last_name: (row['Last Name'] || row['Surname'] || row['last_name'] || '').toString().trim(),
    mobile: cleanPhone(row['Mobile Number'] || row['Mobile'] || row['mobile']),
    membership: (row['Membership'] || row['membership'] || '').toString().trim() || 'Diamond',
    tags: parseTags(row['Tags'] || row['tags']),
    background: commentParts.join('\n\n'),
    month_1: parseBool(row['Month 1'] || row['month_1']),
    month_2: parseBool(row['Month 2'] || row['month_2']),
    month_3: parseBool(row['Month 3'] || row['month_3']),
    month_4: parseBool(row['Month 4'] || row['month_4']),
    month_5: parseBool(row['Month 5'] || row['month_5']),
    month_6: parseBool(row['Month 6'] || row['month_6']),
    is_super_baker_finisher: parseBool(row['SBF'] || row['Super Baker'] || row['Super Baker Finisher'] || row['super_baker']),
    is_hall_of_fame: parseBool(row['Hall of Fame'] || row['HOF'] || row['hall_of_fame'] || row['HallOfFame']),
    certificate_issued: parseBool(row['Certificate'] || row['Certificate Issued'] || row['Cert'] || row['certificate_issued']),
    certificate_issued_date: parseDate(row['Certificate Date'] || row['Cert Date'] || row['certificate_date']),
    bbr_attended: parseBBR(row['BBR2'] || row['BBR'] || row['bbr']),
    bbr_attended_date: parseDate(row['BBR Date'] || row['bbr_date']),
    call_logs: callLogs,
    course_end_date: parseDate(row['Course End Date'] || row['course_end_date']),
    course_start_date: parseDate(row['Course Start Date'] || row['course_start_date']),
  };
}

function parseAmount(v: any): number {
  if (v == null) return 0;
  const s = v.toString().replace(/[,\s]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}
function hasValue(v: any): boolean {
  if (v == null) return false;
  const s = v.toString().trim();
  return s.length > 0 && s.toLowerCase() !== 'false' && s !== '0';
}

// BBR2 column: "BBR2" = attended, "BBR-ABSENT" = absent (NOT attended), "" = no data
function emiCallLogs(row: any): { date: string | null; comment: string; coach_label: string }[] {
  const logs: { date: string | null; comment: string; coach_label: string }[] = [];
  const pairs = [
    { dateCol: 'Call Date',   commentCol: 'Call Remarks', coach: 'Call' },
    { dateCol: 'Call Date',   commentCol: 'DV Comments',  coach: 'DV' },
    { dateCol: 'Call Date.1', commentCol: 'AK Comments',  coach: 'AK' },
  ];
  for (const p of pairs) {
    const comment = row[p.commentCol];
    if (comment && comment.toString().trim()) {
      logs.push({ date: parseDate(row[p.dateCol]), comment: comment.toString().trim(), coach_label: p.coach });
    }
  }
  return logs;
}

function emiComments(row: any): string | null {
  const parts: string[] = [];
  ['Remarks', 'Comments', 'Notes', 'FM Comments', 'DV Comments', 'AK Comments'].forEach(col => {
    const v = row[col];
    if (v && v.toString().trim()) parts.push(`[${col}]: ${v.toString().trim()}`);
  });
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function hasMonthCol(row: any, n: number): boolean {
  return (`Month ${n}` in row) || (`month_${n}` in row);
}

function parseBBR(v: any): boolean {
  if (v == null) return false;
  const s = v.toString().trim().toLowerCase();
  if (s.length === 0) return false;
  if (s.includes('absent')) return false;   // BBR-ABSENT = did not attend
  if (s.includes('bbr')) return true;        // BBR2 = attended
  return false;
}

function parseBool(v: any): boolean {
  if (v == null) return false;
  const s = v.toString().trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}
function parseTags(v: any): string[] {
  if (!v) return [];
  return v.toString().split(/[,;|\s]+/).map((t: string) => t.trim()).filter(Boolean);
}
function cleanPhone(p: any): string {
  if (!p) return '';
  const digits = p.toString().replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.slice(1);
  return digits ? '+' + digits : '';
}
function normalizeMode(m: any): string {
  if (!m) return 'Card';
  const s = m.toString().trim().toLowerCase();
  if (s.includes('card')) return 'Card';
  if (s.includes('neft')) return 'NEFT';
  if (s.includes('bank') || s.includes('transfer') || s.includes('transfter')) return 'Bank Transfer';
  if (s.includes('upi')) return 'UPI';
  if (s.includes('cash')) return 'Cash';
  return m.toString().trim();
}
function parseDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = v.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const m1 = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (m1) {
    const day = m1[1].padStart(2, '0');
    const mon = months[m1[2].substring(0, 3).toLowerCase()];
    if (mon) return `${m1[3]}-${mon}-${day}`;
  }
  const m2 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  return null;
}