import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { getMyPermissions } from '@/lib/check-permission';

// POST /api/students/delete
// body: { ids: string[] }
// Archives one or more students. Gated: admins always, or coaches granted the
// 'delete-students' permission.
//
// This MOVES the student rather than hiding them: archive_students() captures
// the student row plus every call log, installment, checkpoint, briefing and
// reminder into a single snapshot in students_archive, then hard-deletes them
// from the live tables (see supabase/migrations/0010_students_archive.sql).
//
// The old behaviour set students.deleted_at and left everything in place, so
// any list that forgot the `deleted_at IS NULL` filter kept showing the
// student's EMIs and comments. Nothing is left behind now, so that whole class
// of bug is gone. Re-uploading the student's sheet restores the snapshot with
// their original id and history intact.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { isSignedIn, isAdmin, has } = await getMyPermissions();
  if (!isSignedIn) return new NextResponse('unauthenticated', { status: 401 });
  if (!(isAdmin || has('delete-students'))) {
    return new NextResponse('forbidden — delete-students permission required', { status: 403 });
  }

  const { ids } = (await req.json()) as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return new NextResponse('ids required', { status: 400 });
  }

  // Recorded as students_archive.archived_by so it's clear who removed them.
  const { data: { user } } = await supabaseServer().auth.getUser();

  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc('archive_students', {
    p_ids: ids,
    p_actor: user?.id ?? null,
  } as any);
  if (error) return new NextResponse(error.message, { status: 500 });

  // archive_students returns the number of students it actually moved (ids that
  // were already archived or never existed are skipped, not counted).
  return NextResponse.json({ ok: true, count: Number(data ?? 0) });
}
