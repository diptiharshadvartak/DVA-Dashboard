import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghlSearchContactsByTag } from '@/lib/ghl/client';

// This is a bulk job that paginates the whole GHL account. Run it on the Node
// runtime and allow it the full request budget so a large account doesn't get
// the function killed mid-import — when that happened the client never received
// the { imported, updated } result, so the modal could not report success or
// counts. maxDuration is capped by the hosting plan (Vercel Pro = 300s); the
// batched writes below keep a normal import well under that.
export const runtime = 'nodejs';
export const maxDuration = 300;

// POST /api/ghl/import-by-tag
// body: { tag: string }
// Paginates through GHL contacts with the given tag and upserts them into students.
//
// IMPORTANT: GHL contacts often carry 50+ marketing/campaign tags from years of
// workflows (bb15, gps24, bfs2025-l1n, etc.) which are NOT relevant to DVA's
// dashboard tracking. We filter to a small allowlist matching what the
// Diamond Master Sheet actually uses.
//
// Edit ALLOWED_TAGS below to change which GHL tags survive import. The match
// is case-insensitive against the FULL tag string.

const ALLOWED_TAGS = new Set([
  // DVA tracking codes from Master Sheet (Tags column)
  's',
  'sh',
  'shdc',
  'sdc',
  'dc',
  'j',
  'js',
  'jsdc',
  'jdc',
  'j-incomplete',
  // Useful status indicators that map cleanly
  'diamond',
  'diamond waitlist',
  'diamond-interested',
  'alumni',
  'ex-diamond',
  'urgent',
  'absent',
  'on-hold',
]);

function filterDvaTags(rawTags: unknown): string[] {
  if (!rawTags) return [];
  // GHL can return tags as array OR sometimes a comma-separated string.
  const arr: string[] = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t))
    : String(rawTags).split(',').map((t) => t.trim());

  const kept: string[] = [];
  for (const raw of arr) {
    const normalized = raw.trim().toLowerCase();
    if (ALLOWED_TAGS.has(normalized)) {
      // Preserve original casing from GHL
      kept.push(raw.trim());
    }
  }
  // Dedupe preserving order.
  return Array.from(new Set(kept));
}

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse('unauthenticated', { status: 401 });

  // Bulk-writes the students table (insert/update by email) — gate to admins /
  // coaches with the students permission, not just any signed-in user.
  const { data: profile } = await sb.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  const isAdmin = (profile as any)?.role === 'admin';
  const perms = ((profile as any)?.permissions ?? []) as string[];
  if (!isAdmin && !perms.includes('students')) {
    return new NextResponse('forbidden — admin or students permission required', { status: 403 });
  }

  const { tag } = (await req.json()) as { tag: string };
  if (!tag) return new NextResponse('tag required', { status: 400 });

  // ── Stream progress as newline-delimited JSON (NDJSON) ──
  // The import paginates the whole GHL account one page at a time (cursor
  // pagination is inherently sequential), so a large tag can take a minute or
  // more. Instead of making the client wait blind for a single response, we
  // push a {imported, updated, processed} line after every page so the modal
  // can show the counts climbing live. The final line is {type:'done'}.
  const admin = supabaseAdmin();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      let imported = 0, updated = 0, processed = 0;
      let startAfterId: string | undefined, startAfter: string | number | undefined;

      // GHL's search windows can overlap (the cursor is not perfectly stable),
      // which would otherwise reprocess the same contacts and inflate the
      // counts well past the real number of students. Track every contact id we
      // have already handled so each distinct contact is counted and written
      // exactly once, and so we can stop as soon as a page brings nothing new.
      const seenIds = new Set<string>();
      // Several GHL contacts can share one email (the same student). Count and
      // write each email only once so "Updated" reflects distinct students, not
      // raw contact rows.
      const seenEmails = new Set<string>();
      const MAX_PAGES = 500; // backstop against a non-advancing cursor
      let pageNo = 0;

      // GHL's /contacts search treats `query` as a LOOSE TEXT match, so pulling
      // "diamond" also returns contacts tagged "diamond-interested" / "diamond
      // waitlist". Keep only contacts that actually carry the EXACT tag we asked
      // for (case-insensitive). GHL can hand tags back as an array or a
      // comma-separated string, so normalize both shapes.
      const wantedTag = tag.trim().toLowerCase();
      const hasExactTag = (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw.map((t) => String(t)) : String(raw ?? '').split(',');
        return arr.some((t) => t.trim().toLowerCase() === wantedTag);
      };

      try {
        while (true) {
          const page = await ghlSearchContactsByTag(tag, 100, startAfterId, startAfter);
          const all = page.contacts ?? [];
          if (!all.length) break;

          // Drop contacts we have already seen on an earlier (overlapping) page.
          const fresh = all.filter((c) => c.id && !seenIds.has(c.id));
          for (const c of all) if (c.id) seenIds.add(c.id);
          // Every contact on this page was a duplicate → the cursor is looping; stop.
          // (Check this on the unseen set, BEFORE the exact-tag filter, so a page
          // full of loose-match strays doesn't falsely look like a cursor loop.)
          if (!fresh.length) break;

          // Now keep only the contacts with the exact tag — the strays GHL's
          // loose search returned are skipped (not counted, not written).
          const contacts = fresh.filter((c) => hasExactTag(c.tags));
          processed += contacts.length;

          // ── Batch the whole page instead of one DB round-trip per contact ──
          // The old path ran a SELECT + an INSERT/UPDATE for EVERY contact, in
          // series — ~200 round-trips per 100-contact page, which is what made a
          // full import take minutes. We now do one SELECT for all emails on the
          // page and one batched upsert + one batched insert, so each page costs
          // ~3 round-trips. The data written (and the tag-merge) is identical.

          // GHL can return the same email on more than one contact within a page;
          // collapse those here (union their DVA tags, last contact wins for the
          // scalar fields) so a single email maps to a single student row — the
          // same end state the old sequential insert-then-update produced.
          const byEmail = new Map<string, { email: string; tags: string[]; c: any }>();
          for (const c of contacts) {
            if (!c.email) continue;
            const email = c.email.toLowerCase();
            // Already handled on an earlier page (a duplicate-email contact) →
            // skip so it is neither rewritten nor double-counted.
            if (seenEmails.has(email)) continue;
            const tags = filterDvaTags(c.tags);
            // Always keep the tag we pulled by, even if it isn't in the DVA
            // allowlist — otherwise the pulled students wouldn't show that tag or
            // appear under it in the tag filter. Preserve the contact's own casing
            // when present; fall back to the requested tag.
            const pulledTag = (Array.isArray(c.tags) ? c.tags.map((t: any) => String(t)) : String(c.tags ?? '').split(','))
              .map((t: string) => t.trim())
              .find((t: string) => t.toLowerCase() === wantedTag) ?? tag.trim();
            if (pulledTag && !tags.some((t) => t.toLowerCase() === pulledTag.toLowerCase())) {
              tags.push(pulledTag);
            }
            const prev = byEmail.get(email);
            if (prev) {
              prev.tags = Array.from(new Set([...prev.tags, ...tags]));
              prev.c = c;
            } else {
              byEmail.set(email, { email, tags, c });
            }
          }
          for (const email of byEmail.keys()) seenEmails.add(email);

          const emails = Array.from(byEmail.keys());
          if (emails.length) {
            // One lookup for every existing student on this page (was one per contact).
            const { data: existingRows } = await admin
              .from('students')
              .select('id, email, tags')
              .in('email', emails);
            const existingByEmail = new Map<string, { id: string; tags: string[] }>();
            for (const r of (existingRows ?? []) as any[]) {
              existingByEmail.set(String(r.email).toLowerCase(), {
                id: r.id,
                tags: ((r.tags ?? []) as string[]),
              });
            }

            // Classify only here — the counts are incremented AFTER a confirmed
            // write below, so the streamed totals reflect what actually persisted
            // rather than what we intended to write (the old code counted before
            // writing and never checked the result, which inflated "New"/"Updated"
            // whenever a write silently failed).
            const toUpdate: any[] = [];
            const toInsert: any[] = [];
            for (const { email, tags, c } of byEmail.values()) {
              const existing = existingByEmail.get(email);
              // Merge with existing tags so coaches' manual additions aren't lost.
              const merged = Array.from(new Set([...(existing?.tags ?? []), ...tags]));
              const payload: any = {
                ghl_contact_id: c.id,
                email,
                first_name: c.firstName ?? null,
                last_name: c.lastName ?? null,
                mobile: c.phone ?? null,
                tags: merged,
              };
              if (existing) {
                // Upsert on the primary key: only the columns above are written, so
                // other student fields stay untouched — same as the old .update().
                payload.id = existing.id;
                toUpdate.push(payload);
              } else {
                toInsert.push(payload);
              }
            }

            // Updates key on the PK, so the bulk upsert is safe; fall back to
            // per-row only if the batch errors, so one bad row can't drop the rest.
            if (toUpdate.length) {
              const { error } = await admin.from('students').upsert(toUpdate);
              if (!error) {
                updated += toUpdate.length;
              } else {
                for (const row of toUpdate) {
                  const { error: e } = await admin.from('students').upsert(row);
                  if (!e) updated++;
                }
              }
            }

            // Inserts share ONE statement, so a single unique violation (a reused
            // ghl_contact_id, or a lower(email) row the lookup missed) would roll
            // back the WHOLE page. Try the fast bulk insert first; on any error,
            // retry row-by-row, and for a row that collides with an existing
            // student, update it by email instead — so nothing is silently lost
            // and the counts stay honest (only count rows that actually changed).
            if (toInsert.length) {
              const { error } = await admin.from('students').insert(toInsert);
              if (!error) {
                imported += toInsert.length;
              } else {
                for (const row of toInsert) {
                  const { error: e } = await admin.from('students').insert(row);
                  if (!e) { imported++; continue; }
                  const { id: _omit, ...rest } = row;
                  const { data: upd } = await admin
                    .from('students')
                    .update(rest)
                    .eq('email', row.email)
                    .select('id');
                  if (upd && upd.length > 0) updated++;
                }
              }
            }
          }

          // Push the running totals to the client after each page.
          send({ type: 'progress', imported, updated, processed });

          // Advance the compound cursor from the LAST raw contact on the page
          // (meta values win when GHL provides them).
          const last = all[all.length - 1];
          const nextId = page.meta?.startAfterId ?? last?.id;
          const nextAfter = page.meta?.startAfter ?? last?.dateAdded ?? undefined;
          // GHL returned a full page but no usable cursor, or the cursor did not
          // move — either way we cannot make progress, so stop.
          if (!nextId || (nextId === startAfterId && nextAfter === startAfter)) break;
          startAfterId = nextId;
          startAfter = nextAfter ?? undefined;
          if (all.length < 100) break;
          if (++pageNo >= MAX_PAGES) break;
        }

        await admin.from('ghl_settings').update({ last_full_sync: new Date().toISOString() }).eq('id', 1);
        send({ type: 'done', imported, updated, processed });
      } catch (e: any) {
        send({ type: 'error', message: e?.message ?? 'import failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop nginx/proxy layers from buffering the whole body — without this the
      // progress lines would only arrive once the import finished.
      'X-Accel-Buffering': 'no',
    },
  });
}