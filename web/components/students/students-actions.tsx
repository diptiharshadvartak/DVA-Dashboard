'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, DownloadCloud, Plus, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/shell/toast-region';
import { ImportExcelModal } from './import-excel-modal';
import { EmiSetupForm, emiDefaults, saveEmiPlan, type EmiSetupValue } from './emi-setup-modal';

export function StudentsActions() {
  const router = useRouter();
  const [openAdd, setOpenAdd] = useState(false);
  const [openPull, setOpenPull] = useState(false);
  const [openCsv, setOpenCsv] = useState(false);
  const [openExcel, setOpenExcel] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button onClick={() => setOpenExcel(true)}>
          <UploadCloud className="w-4 h-4" /> Import Excel
        </Button>
        <Button onClick={() => setOpenPull(true)}>
          <DownloadCloud className="w-4 h-4" /> Pull from GHL
        </Button>
        <Button variant="primary" onClick={() => setOpenAdd(true)}>
          <Plus className="w-4 h-4" /> Add student
        </Button>
      </div>

      {openAdd && <AddStudentModal onClose={() => setOpenAdd(false)} onCreated={() => router.refresh()} />}
      {openPull && <PullFromGhlModal onClose={() => setOpenPull(false)} onDone={() => router.refresh()} />}
      {openCsv && <ImportCsvModal onClose={() => setOpenCsv(false)} onDone={() => router.refresh()} />}
      {openExcel && <ImportExcelModal onClose={() => setOpenExcel(false)} onDone={() => router.refresh()} />}
    </>
  );
}

/* ----------------------- Add student (now with optional EMI plan) ----------------------- */

function AddStudentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', mobile: '',
    membership: 'Diamond',
    start_date: new Date().toISOString().slice(0, 10), end_date: '',
    student_group: '', tags: '',
  });
  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  const [includeEmi, setIncludeEmi] = useState(false);
  const [emi, setEmi] = useState<EmiSetupValue>(emiDefaults());

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email.trim() || !form.first_name.trim()) {
      toast('First name and email are required.', 'error');
      return;
    }
    setBusy(true);

    const tagsArr = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const payload: any = {
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim() || null,
      email:      form.email.trim().toLowerCase(),
      mobile:     form.mobile.trim() || null,
      membership: form.membership || null,
      start_date: form.start_date || null,
      end_date:   form.end_date   || null,
      student_group: form.student_group.trim() || null,
      tags:       tagsArr,
    };

    // 1. Insert student
    const { data: created, error } = await sb.from('students').insert(payload).select('id').single();
    if (error) {
      setBusy(false);
      const code = (error as any).code;
      toast(code === '23505' ? `A student with the email "${payload.email}" already exists.` : error.message, 'error');
      return;
    }

    // 2. Optionally save EMI plan
    if (includeEmi && created?.id) {
      const out = await saveEmiPlan(sb, created.id, emi);
      if (!out.ok) {
        setBusy(false);
        toast(`Student created but EMI failed: ${out.error}`, 'error');
        onCreated(); onClose();
        return;
      }
    }

    setBusy(false);
    toast(includeEmi ? `${payload.first_name} added with EMI plan.` : `${payload.first_name} added.`, 'success');
    onCreated();
    onClose();
  }

  return (
    <ModalShell title="Add student" onClose={onClose} wide>
      <form onSubmit={onSubmit} className="overflow-auto">
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name *"><input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={fieldCls} placeholder="Priya" autoFocus /></Field>
            <Field label="Last name"><input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={fieldCls} placeholder="Sharma" /></Field>
          </div>
          <Field label="Email *"><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldCls} placeholder="priya@example.com" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile"><input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} className={fieldCls} placeholder="+91 90000 00000" /></Field>
            <Field label="Membership">
              <select value={form.membership} onChange={(e) => set('membership', e.target.value)} className={fieldCls}>
                <option>Diamond</option><option>Ex-Diamond</option><option>Trial</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} className={fieldCls} /></Field>
            <Field label="End date"><input type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} className={fieldCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch / Group"><input value={form.student_group} onChange={(e) => set('student_group', e.target.value)} className={fieldCls} placeholder="Batch A" /></Field>
            <Field label="Tags (comma-separated)"><input value={form.tags} onChange={(e) => set('tags', e.target.value)} className={fieldCls} placeholder="SH, BBR2" /></Field>
          </div>
        </div>

        {/* Toggle for EMI plan */}
        <div className="border-t border-ink-100">
          <button
            type="button"
            onClick={() => setIncludeEmi((b) => !b)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-ink-50 text-left"
          >
            <span className="flex items-center gap-2">
              <span className={`w-4 h-4 rounded border grid place-items-center ${includeEmi ? 'bg-accent-600 border-accent-600 text-white' : 'border-ink-300'}`}>
                {includeEmi && <span className="block w-2 h-2 rounded-sm bg-white" />}
              </span>
              <span className="text-[13.5px] font-medium">Set up EMI plan now</span>
              <span className="text-[11.5px] text-ink-500">(you can also add it later from the student's Payments tab)</span>
            </span>
            {includeEmi ? <ChevronUp className="w-4 h-4 text-ink-500" /> : <ChevronDown className="w-4 h-4 text-ink-500" />}
          </button>

          {includeEmi && (
            <div className="px-5 pb-5 pt-1">
              <EmiSetupForm value={emi} onChange={setEmi} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink-100">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : (includeEmi ? 'Add student + EMI' : 'Add student')}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ----------------------- Pull from GHL ----------------------- */

function PullFromGhlModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [tag, setTag] = useState('Diamond');
  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  // Live running totals streamed from the server, one update per page.
  // null until the first progress line arrives (the "connecting" window).
  const [progress, setProgress] = useState<{ imported: number; updated: number; processed: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; updated: number } | null>(null);

  // Tick the elapsed timer every second while busy.
  useEffect(() => {
    if (!busy) return;
    setElapsedSec(0);
    const start = Date.now();
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function run() {
    if (!tag.trim()) { toast('Tag is required.', 'error'); return; }
    setBusy(true); setResult(null); setProgress(null);
    try {
      const res = await fetch('/api/ghl/import-by-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: tag.trim() }),
      });

      // Auth / validation failures come back as a normal non-OK text response,
      // before the stream starts.
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        if (text.toLowerCase().includes('ghl_pit_token') || text.toLowerCase().includes('unauthorized') || text.toLowerCase().includes('token')) {
          toast('GHL token not configured. Open Settings → GoHighLevel to add it.', 'error');
        } else toast(text || 'Pull failed.', 'error');
        setBusy(false);
        return;
      }

      // Read the NDJSON stream line by line and update the live counters.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let final: { imported: number; updated: number } | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? ''; // keep the trailing partial line for the next chunk
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === 'progress') {
            setProgress({ imported: msg.imported ?? 0, updated: msg.updated ?? 0, processed: msg.processed ?? 0 });
          } else if (msg.type === 'done') {
            final = { imported: msg.imported ?? 0, updated: msg.updated ?? 0 };
          } else if (msg.type === 'error') {
            streamError = msg.message ?? 'Import failed.';
          }
        }
      }

      if (streamError) { toast(streamError, 'error'); setBusy(false); return; }

      const summary = final ?? { imported: progress?.imported ?? 0, updated: progress?.updated ?? 0 };
      setResult(summary);
      toast(`Imported ${summary.imported} · Updated ${summary.updated}`, 'success');
      onDone();
    } catch (e: any) {
      toast(e.message ?? 'Network error.', 'error');
    } finally { setBusy(false); }
  }

  function reset() {
    setResult(null);
    setProgress(null);
  }

  return (
    <ModalShell title="Pull from GoHighLevel" onClose={onClose}>
      <div className="p-5 space-y-4">
        {!busy && !result && (
          <>
            <p className="text-[12.5px] text-ink-500">
              Imports all GHL contacts that carry the tag below. Existing students (matched by email) are updated; new ones are inserted. Safe to re-run.
            </p>
            <label className="block">
              <div className="text-[12px] font-medium text-ink-700 mb-1">GHL tag</div>
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Diamond" className={fieldCls} autoFocus />
              <div className="text-[11px] text-ink-500 mt-1">Try tags like <span className="font-mono">Diamond</span>, <span className="font-mono">SH</span>, <span className="font-mono">BBR2</span>.</div>
            </label>
          </>
        )}

        {busy && (
          <div className="py-6 px-2">
            <div className="flex items-center justify-center mb-5">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-full border-4 border-accent-100" />
                <div className="absolute inset-0 rounded-full border-4 border-accent-500 border-t-transparent animate-spin" />
              </div>
            </div>
            <div className="text-center mb-4">
              <div className="text-[15px] font-semibold text-ink-900 mb-1">Pulling from GoHighLevel</div>
              <div className="text-[12px] text-ink-500">Tag: <span className="font-mono">{tag}</span> · {elapsedSec}s elapsed</div>
            </div>

            {progress ? (
              <>
                {/* Big live counter — climbs as each page of contacts is saved. */}
                <div className="text-center mb-1">
                  <div className="text-[40px] leading-none font-bold text-accent-600 tabular-nums">
                    {progress.imported + progress.updated}
                  </div>
                  <div className="text-[11.5px] text-ink-500 mt-1 uppercase tracking-wider">contacts synced</div>
                </div>
                <div className="flex items-center justify-center gap-6 text-[13px] mt-3">
                  <div className="text-center">
                    <div className="text-emerald-600 font-semibold text-[18px] tabular-nums">{progress.imported}</div>
                    <div className="text-ink-500 text-[10.5px] uppercase tracking-wider">New</div>
                  </div>
                  <div className="w-px h-9 bg-ink-200" />
                  <div className="text-center">
                    <div className="text-accent-600 font-semibold text-[18px] tabular-nums">{progress.updated}</div>
                    <div className="text-ink-500 text-[10.5px] uppercase tracking-wider">Updated</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center text-[13px] text-accent-700 font-medium">Connecting to GHL…</div>
            )}

            <p className="text-[11px] text-ink-400 text-center mt-5">
              This can take 30 seconds to 3 minutes depending on how many contacts. Don't close this window.
            </p>
          </div>
        )}

        {result && !busy && (
          <div className="py-6 px-2 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-[18px] font-semibold text-ink-900 mb-2">Done!</div>
            <div className="text-[13.5px] text-ink-600 mb-5">
              Successfully synced <span className="font-semibold">{result.imported + result.updated}</span> students with GHL
            </div>
            <div className="flex items-center justify-center gap-6 text-[13px] mb-2">
              <div>
                <div className="text-emerald-600 font-semibold text-[20px]">{result.imported}</div>
                <div className="text-ink-500 text-[11px] uppercase tracking-wider">New</div>
              </div>
              <div className="w-px h-10 bg-ink-200" />
              <div>
                <div className="text-accent-600 font-semibold text-[20px]">{result.updated}</div>
                <div className="text-ink-500 text-[11px] uppercase tracking-wider">Updated</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {result && !busy ? (
            <>
              <Button type="button" onClick={reset}>Pull another tag</Button>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={run} disabled={busy}>
                {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Pulling…</> : 'Pull now'}
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

/* ----------------------- Import CSV ----------------------- */

function ImportCsvModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const sb = supabaseBrowser();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ inserted: number; updated: number } | null>(null);

  function parseCsv(text: string): { rows: any[]; errors: string[] } {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return { rows: [], errors: ['CSV must have a header row and at least one data row.'] };
    const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (!headers.includes('email')) return { rows: [], errors: ['Missing required column: email'] };
    const out: any[] = [], errs: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const row: any = {};
      headers.forEach((h, idx) => { row[h] = (cols[idx] ?? '').trim(); });
      if (!row.email) { errs.push(`Row ${i + 1}: missing email`); continue; }
      out.push({
        email:      String(row.email).toLowerCase(),
        first_name: row.first_name || null,
        last_name:  row.last_name  || null,
        mobile:     row.mobile     || null,
        membership: row.membership || null,
        tags:       row.tags ? String(row.tags).split(/[,;|]+/).map((t: string) => t.trim()).filter(Boolean) : [],
        start_date: normaliseDate(row.start_date),
        end_date:   normaliseDate(row.end_date),
        background: row.background || null,
      });
    }
    return { rows: out, errors: errs };
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed.rows); setErrors(parsed.errors); setDone(null);
  }

  async function commit() {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      let inserted = 0, updated = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const emails = chunk.map((r) => r.email);
        const { data: existing } = await sb.from('students').select('email').in('email', emails);
        const existingSet = new Set((existing ?? []).map((r: any) => r.email));
        const { error } = await sb.from('students').upsert(chunk, { onConflict: 'email' });
        if (error) throw error;
        for (const r of chunk) { if (existingSet.has(r.email)) updated++; else inserted++; }
      }
      setDone({ inserted, updated });
      toast(`CSV imported: ${inserted} new · ${updated} updated.`, 'success');
      onDone();
    } catch (e: any) { toast(e.message ?? 'Import failed.', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <ModalShell title="Import students from CSV" onClose={onClose}>
      <div className="p-5 space-y-4">
        <p className="text-[12.5px] text-ink-500">
          CSV must contain an <span className="font-mono">email</span> column. Optional: <span className="font-mono">first_name, last_name, mobile, membership, tags, start_date, end_date, background</span>.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="w-full h-20 rounded-lg border-2 border-dashed border-ink-200 hover:border-accent-400 hover:bg-accent-50/30 flex flex-col items-center justify-center gap-1 text-[12.5px] text-ink-500">
          <UploadCloud className="w-5 h-5 text-ink-400" />
          Click to choose a .csv file
        </button>
        {errors.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800 space-y-0.5">
            {errors.slice(0, 6).map((e, i) => <div key={i}>• {e}</div>)}
            {errors.length > 6 && <div>…and {errors.length - 6} more.</div>}
          </div>
        )}
        {rows.length > 0 && !done && (
          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3 text-[12.5px]">
            Ready to import <span className="font-semibold">{rows.length}</span> rows.
          </div>
        )}
        {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[12.5px] text-emerald-800">✓ {done.inserted} new · {done.updated} updated.</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" onClick={commit} disabled={busy || rows.length === 0}>
            {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</> : `Import ${rows.length || ''} row${rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ----------------------- shared bits ----------------------- */

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[6vh] px-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div
        className={`relative w-full ${wide ? 'max-w-[640px]' : 'max-w-[540px]'} bg-white rounded-2xl shadow-pop border border-ink-200/70 overflow-hidden max-h-[88vh] flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-ink-100 shrink-0">
          <div className="font-semibold text-[15px]">{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-md hover:bg-ink-100 grid place-items-center" aria-label="Close">
            <X className="w-4 h-4 text-ink-500" />
          </button>
        </div>
        {children}
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

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function normaliseDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}