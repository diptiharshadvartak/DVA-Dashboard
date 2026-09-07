-- DVA Dashboard — replace the students archive with a true hard delete
--
-- WHY
-- 0010 made deleting a student a MOVE: snapshot every row into
-- students_archive, then clear the live tables, with restore_students()
-- putting them back on the next re-upload. That was the right call for
-- "deleted students keep showing up", but it is not what this deployment
-- wants: a delete is meant to erase the person, not park them.
--
-- WHAT
-- students_archive and its three functions are gone. delete_students()
-- takes their place and removes every trace of the student: installments,
-- course progress, checkpoints, call logs, briefings, reminders, payment
-- events and the audit trail.
--
-- Anyone sitting in students_archive when this runs is dropped with the
-- table. That is deliberate and was chosen explicitly — they were deleted
-- on purpose, and the archive is not being carried forward.
--
-- CONSEQUENCE
-- Re-uploading a deleted student's sheet now creates a NEW person: new
-- uuid, no EMIs, no call history, progress reset. There is no longer any
-- way back. The importers drop their restore branch to match.
--
-- students.deleted_at is intentionally left in place. Nothing writes it
-- any more, so the `deleted_at is null` filters dotted around the app
-- become harmless no-ops rather than something to go and rip out.
--
-- Referenced by:
--   web/app/api/students/delete/route.ts   (delete_students)

-- ============================================================================
-- 1. Tear down the archive
--
-- The functions go first: restore_students() reads students_archive, so
-- dropping the table out from under it would leave a function that only
-- fails at call time.
-- ============================================================================
drop function if exists public.restore_students(text[], uuid);
drop function if exists public.archive_students(uuid[], uuid);
drop function if exists public.archive_student(uuid, uuid);
drop table if exists public.students_archive;

-- ============================================================================
-- 2. delete_student(id) — erase one student and everything belonging to them
--
-- ORDER MATTERS, for three separate reasons:
--
--   a. cashfree_events and reminders can carry an emi_id with a NULL
--      student_id, so both are matched on the installment ids as well.
--      Those ids have to be collected BEFORE anything is deleted.
--   b. cashfree_events.student_id / .emi_id are ON DELETE SET NULL, so
--      letting the students cascade run first would not remove them — it
--      would silently orphan them with both links nulled, unfindable.
--      They must go while the links still point somewhere.
--   c. reminders.emi_id references emi_schedule with NO on-delete action,
--      so a surviving reminder blocks the emi_schedule cascade and the
--      whole delete fails.
--
-- audit_log is purged LAST because the students_audit and emi_audit
-- triggers write into it *during* the deletes above — purging any earlier
-- just leaves a fresh snapshot of the row we were trying to erase.
-- ============================================================================
create or replace function public.delete_student(p_student_id uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emi_ids uuid[];
begin
  if not exists (select 1 from public.students where id = p_student_id) then
    return null;  -- already gone, or never existed
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_emi_ids
    from public.emi_schedule where student_id = p_student_id;

  delete from public.cashfree_events
   where student_id = p_student_id or emi_id = any(v_emi_ids);

  delete from public.reminders
   where student_id = p_student_id or emi_id = any(v_emi_ids);

  delete from public.weekly_checkpoints where student_id = p_student_id;

  -- Cascades: call_logs, emi_schedule, student_briefings.
  delete from public.students where id = p_student_id;

  -- entity_id covers both triggers: the student row and every installment.
  delete from public.audit_log
   where entity_id = p_student_id or entity_id = any(v_emi_ids);

  return p_student_id;
end;
$$;

comment on function public.delete_student(uuid, uuid) is
  'Permanently erase one student and every row belonging to them - installments, checkpoints, call logs, briefings, reminders, cashfree events and audit trail. Irreversible. Returns the id, or null if the student did not exist.';

-- Batch wrapper — the delete API sends the whole selection in one call.
create or replace function public.delete_students(p_ids uuid[], p_actor uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  n    int := 0;
begin
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    if public.delete_student(v_id, p_actor) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

comment on function public.delete_students(uuid[], uuid) is
  'Permanently erase several students. Returns how many actually existed and were removed.';

-- ============================================================================
-- 3. Grants — server-side only (the API route uses the service-role key)
-- ============================================================================
revoke all on function public.delete_student(uuid, uuid)     from public, anon, authenticated;
revoke all on function public.delete_students(uuid[], uuid)  from public, anon, authenticated;
grant execute on function public.delete_student(uuid, uuid)    to service_role;
grant execute on function public.delete_students(uuid[], uuid) to service_role;

-- ============================================================================
-- 4. Self-test — build a student with one of everything, delete them, and
--    assert that NOTHING survives. Any failed assertion aborts the
--    migration, so an incomplete erasure is never deployed.
-- ============================================================================
do $$
declare
  v_id      uuid := gen_random_uuid();
  v_email   text := 'delete-selftest-' || replace(v_id::text, '-', '') || '@example.invalid';
  v_coach   uuid;
  v_emi     uuid;
  v_n       int;
  v_removed int;
begin
  select id into v_coach from public.profiles order by created_at limit 1;

  insert into public.students (id, email, first_name, last_name, membership)
  values (v_id, v_email, 'Delete', 'Selftest', 'Diamond');

  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date)
  values (v_id, 1, 2, 5000, current_date + 10, current_date + 7);

  select id into v_emi from public.emi_schedule
   where student_id = v_id and installment_no = 1;

  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date)
  values (v_id, 2, 2, 5000, current_date + 40, current_date + 37);

  insert into public.weekly_checkpoints (student_id, week_no, completed)
  values (v_id, 1, true), (v_id, 2, true);

  -- The nastiest shape: student_id NULL, reachable only through emi_id.
  -- If the delete matched on student_id alone these would be left behind.
  insert into public.cashfree_events (emi_id, student_id, event_type)
  values (v_emi, null, 'selftest_link'), (null, v_id, 'selftest_webhook');

  insert into public.reminders (event_id, student_id, emi_id, channel, status)
  values ('selftest', null, v_emi, 'whatsapp', 'queued');

  -- call_logs.coach_id is NOT NULL; skip that leg on a database with no profiles yet.
  if v_coach is not null then
    insert into public.call_logs (student_id, coach_id, comment, outcome)
    values (v_id, v_coach, 'selftest call', 'connected');
  end if;

  -- ---- delete ----
  v_removed := public.delete_students(array[v_id], null);
  if v_removed <> 1 then
    raise exception 'delete_students: expected to remove 1 student, reported %', v_removed;
  end if;

  if exists (select 1 from public.students where id = v_id) then
    raise exception 'delete_student: student row survived';
  end if;

  select count(*) into v_n from public.emi_schedule where student_id = v_id;
  if v_n <> 0 then raise exception 'delete_student: % emi_schedule row(s) survived', v_n; end if;

  select count(*) into v_n from public.weekly_checkpoints where student_id = v_id;
  if v_n <> 0 then raise exception 'delete_student: % weekly_checkpoints row(s) survived', v_n; end if;

  select count(*) into v_n from public.call_logs where student_id = v_id;
  if v_n <> 0 then raise exception 'delete_student: % call_logs row(s) survived', v_n; end if;

  select count(*) into v_n from public.student_briefings where student_id = v_id;
  if v_n <> 0 then raise exception 'delete_student: % student_briefings row(s) survived', v_n; end if;

  select count(*) into v_n from public.reminders where student_id = v_id or emi_id = v_emi;
  if v_n <> 0 then raise exception 'delete_student: % reminder(s) survived', v_n; end if;

  select count(*) into v_n from public.cashfree_events where student_id = v_id or emi_id = v_emi;
  if v_n <> 0 then raise exception 'delete_student: % cashfree_event(s) survived', v_n; end if;

  select count(*) into v_n from public.audit_log where entity_id = v_id or entity_id = v_emi;
  if v_n <> 0 then raise exception 'delete_student: % audit_log row(s) survived', v_n; end if;

  raise notice 'hard-delete self-test passed — nothing survived';
end;
$$;

-- Tell PostgREST to pick up the new functions and forget the old ones.
notify pgrst, 'reload schema';
