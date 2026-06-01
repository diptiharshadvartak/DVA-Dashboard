import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghlSearchContactsByTag } from '@/lib/ghl/client';

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

  const admin = supabaseAdmin();
  let imported = 0, updated = 0, startAfterId: string | undefined;

  try {
    while (true) {
      const page = await ghlSearchContactsByTag(tag, 100, startAfterId);
      const contacts = page.contacts ?? [];
      if (!contacts.length) break;

      for (const c of contacts) {
        if (!c.email) continue;
        const { data: existing } = await admin
          .from('students')
          .select('id, tags')
          .eq('email', c.email.toLowerCase())
          .maybeSingle();

        const filteredFromGhl = filterDvaTags(c.tags);

        // Merge with existing tags so coaches' manual additions aren't lost.
        const existingTags = ((existing as any)?.tags ?? []) as string[];
        const merged = Array.from(new Set([...existingTags, ...filteredFromGhl]));

        const payload = {
          ghl_contact_id: c.id,
          email: c.email.toLowerCase(),
          first_name: c.firstName ?? null,
          last_name: c.lastName ?? null,
          mobile: c.phone ?? null,
          tags: merged,
        };
        if (existing) {
          await admin.from('students').update(payload).eq('id', existing.id);
          updated++;
        } else {
          await admin.from('students').insert(payload);
          imported++;
        }
      }

      startAfterId = page.meta?.startAfterId ?? page.contacts[page.contacts.length - 1]?.id;
      if (!startAfterId || contacts.length < 100) break;
    }

    await admin.from('ghl_settings').update({ last_full_sync: new Date().toISOString() }).eq('id', 1);
    return NextResponse.json({ ok: true, imported, updated });
  } catch (e: any) {
    return new NextResponse(e.message ?? 'import failed', { status: 500 });
  }
}