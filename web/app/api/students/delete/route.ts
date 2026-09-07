import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { getMyPermissions } from '@/lib/check-permission';

// POST /api/students/delete
// body: { ids: string[] }
// PERMANENTLY erases one or more students. Gated: admins always, or coaches
// granted the 'delete-students' permission.
//
// delete_students() removes every trace of the student — the student row plus
// every installment, checkpoint, call log, briefing, reminder, cashfree event
// and audit_log entry (see supabase/migrations/0011_hard_delete_students.sql).
//
// This is IRREVERSIBLE and there is no undo. Two earlier designs were tried
// and dropped: students.deleted_at left everything in the live tables, so any
// list that forgot the `deleted_at IS NULL` filter kept showing the student's
// EMIs and comments; students_archive snapshotted them so a re-upload could
// bring them back. Neither is in play any more — a delete means gone, and
// re-uploading the sheet creates a brand-new student with no history.
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

  const { data: { user } } = await supabaseServer().auth.getUser();

  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc('delete_students', {
    p_ids: ids,
    p_actor: user?.id ?? null,
  } as any);
  if (error) return new NextResponse(error.message, { status: 500 });

  // delete_students returns the number of students it actually removed (ids
  // that were already gone or never existed are skipped, not counted).
  return NextResponse.json({ ok: true, count: Number(data ?? 0) });
}
