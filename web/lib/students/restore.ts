import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Bring back any archived students matching these emails.
 *
 * Deleting a student moves them out of the live tables and into
 * students_archive (see supabase/migrations/0010_students_archive.sql). Every
 * importer looks a student up by email and creates them if the lookup misses —
 * without this call a re-upload would miss the archived row and create a fresh,
 * empty student, orphaning their EMIs and call history in the archive forever.
 *
 * restore_students() is a no-op for emails that aren't archived, and it skips
 * anyone whose email is already live, so it is safe to call speculatively.
 *
 * Returns lower(email) -> restored student id, for the students it actually
 * brought back. Throws if the RPC fails, so the caller can report it rather
 * than silently importing a duplicate.
 */
export async function restoreArchivedStudents(
  admin: SupabaseClient,
  emails: string[],
  actorId: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  const wanted = Array.from(
    new Set(emails.map((e) => (e ?? '').trim()).filter((e) => e.length > 0)),
  );
  if (wanted.length === 0) return out;

  const { data, error } = await admin.rpc('restore_students', {
    p_emails: wanted,
    p_actor: actorId,
  } as any);
  if (error) throw new Error(`could not restore archived student — ${error.message}`);

  for (const r of ((data ?? []) as any[])) {
    if (r?.email && r?.student_id) {
      out.set(String(r.email).toLowerCase(), String(r.student_id));
    }
  }
  return out;
}
