import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghlUpsertContact } from '@/lib/ghl/client';

// POST /api/ghl/upsert-contact
// body: { studentId: string }
// Mirrors a Supabase student row → GHL Contact (idempotent by email).

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse('unauthenticated', { status: 401 });

  // Reads a student's PII and pushes it to GHL — gate to admins / coaches with
  // the students permission, not just any signed-in user.
  const { data: profile } = await sb.from('profiles').select('role, permissions').eq('id', user.id).maybeSingle();
  const isAdmin = (profile as any)?.role === 'admin';
  const perms = ((profile as any)?.permissions ?? []) as string[];
  if (!isAdmin && !perms.includes('students')) {
    return new NextResponse('forbidden — admin or students permission required', { status: 403 });
  }

  const { studentId } = (await req.json()) as { studentId: string };
  if (!studentId) return new NextResponse('studentId required', { status: 400 });

  const { data: s } = await sb.from('students').select('*').eq('id', studentId).maybeSingle();
  if (!s) return new NextResponse('student not found', { status: 404 });

  try {
    const r = await ghlUpsertContact({
      email: s.email,
      firstName: s.first_name ?? null,
      lastName: s.last_name ?? null,
      phone: s.mobile ?? null,
      tags: s.tags ?? [],
      customFields: [
        { key: 'membership',  value: s.membership ?? '' },
        { key: 'start_date',  value: s.start_date  ?? '' },
        { key: 'end_date',    value: s.end_date    ?? '' },
        { key: 'background',  value: s.background  ?? '' },
      ],
    });
    if (r.contact?.id && r.contact.id !== s.ghl_contact_id) {
      await supabaseAdmin().from('students').update({ ghl_contact_id: r.contact.id }).eq('id', s.id);
    }
    return NextResponse.json({ ok: true, contact: r.contact });
  } catch (e: any) {
    return new NextResponse(e.message ?? 'upsert failed', { status: 500 });
  }
}
