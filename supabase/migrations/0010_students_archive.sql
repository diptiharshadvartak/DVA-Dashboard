-- DVA Dashboard — students_archive: a real "inactive" store for deleted students
--
-- WHY
-- Deleting a student used to mean setting students.deleted_at. The row and all
-- its children stayed in the live tables, so anything that forgot the
-- `deleted_at IS NULL` filter kept showing them — the EMI Tracker, the Comments
-- feed and the Follow-ups list all did. Re-uploading the student's sheet found
-- the hidden row and updated it without clearing deleted_at, so they never came
-- back.
--
-- WHAT
-- Deleting a student now MOVES them: every row belonging to them is captured
-- into one jsonb snapshot in public.students_archive, then hard-deleted from the
-- live tables. Nothing is left behind to leak into a query, so the "deleted
-- student still shows" class of bug is gone by construction rather than by
-- remembering a filter. Re-uploading their sheet restores the snapshot — same
-- UUID, same EMIs, same call history.
--
-- One archive table with a snapshot, rather than six mirror tables, because the
-- snapshot is schema-agnostic: to_jsonb / jsonb_populate_record carry whatever
-- columns exist at the time, so adding a column to students never means
-- remembering to add it to students_inactive too.
--
-- Referenced by:
--   web/app/api/students/delete/route.ts              (archive_students)
--   web/app/api/students/import-master-sheet/route.ts (restore_students)
--   web/app/api/students/import-emi-tracker/route.ts  (restore_students)
--   web/app/api/ghl/import-by-tag/route.ts            (restore_students)

-- ============================================================================
-- 0. weekly_checkpoints — used by the app since day one but never captured in a
--    migration, so a fresh database didn't have it and the archive functions
--    below would fail on it. Idempotent: a no-op on the live DB where it exists.
-- ============================================================================
create table if not exists public.weekly_checkpoints (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  week_no    int not null check (week_no between 1 and 24),
  completed  boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (student_id, week_no)
);
create index if not exists weekly_checkpoints_student on public.weekly_checkpoints (student_id);

-- Same access rule as call_logs / emi_schedule. Without this the table is
-- readable with the anon key; the Progress tab is unaffected because it always
-- runs as an authenticated user.
alter table public.weekly_checkpoints enable row level security;
drop policy if exists "weekly_checkpoints rw" on public.weekly_checkpoints;
create policy "weekly_checkpoints rw" on public.weekly_checkpoints for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ============================================================================
-- 1. The archive table
-- ============================================================================
create table if not exists public.students_archive (
  id             uuid primary key,          -- the ORIGINAL students.id, preserved
  email          text not null,
  ghl_contact_id text,
  first_name     text,
  last_name      text,
  snapshot       jsonb not null,            -- student row + every child row
  archived_at    timestamptz not null default now(),
  archived_by    uuid references public.profiles(id)
);

-- One archive row per person: archiving someone who was already archived
-- replaces the older snapshot (see archive_student).
create unique index if not exists students_archive_email_uniq
  on public.students_archive (lower(email));
create index if not exists students_archive_ghl
  on public.students_archive (ghl_contact_id) where ghl_contact_id is not null;
create index if not exists students_archive_at
  on public.students_archive (archived_at desc);

comment on table public.students_archive is
  'Deleted students. One row per student; snapshot holds the students row plus all call_logs, emi_schedule, weekly_checkpoints, student_briefings and reminders. Restored by restore_students().';

-- Holds personal data — no client access at all. The API routes reach it with
-- the service-role key, which bypasses RLS.
alter table public.students_archive enable row level security;
drop policy if exists "archive admin read" on public.students_archive;
create policy "archive admin read" on public.students_archive for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- ============================================================================
-- 2. archive_student(id) — snapshot, then hard-delete from the live tables
-- ============================================================================
create or replace function public.archive_student(p_student_id uuid, p_actor uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student  public.students%rowtype;
  v_snapshot jsonb;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found then
    return null;  -- already archived, or never existed
  end if;

  -- Capture everything BEFORE deleting anything. reminders are matched on
  -- student_id OR emi_id: a reminder can carry only the emi_id, and those rows
  -- would otherwise be left behind pointing at an installment we are about to
  -- delete.
  v_snapshot := jsonb_build_object(
    'version', 1,
    'student', to_jsonb(v_student),
    'call_logs', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
        from public.call_logs t where t.student_id = p_student_id), '[]'::jsonb),
    'emi_schedule', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.installment_no)
        from public.emi_schedule t where t.student_id = p_student_id), '[]'::jsonb),
    'weekly_checkpoints', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.week_no)
        from public.weekly_checkpoints t where t.student_id = p_student_id), '[]'::jsonb),
    'student_briefings', coalesce((
      select jsonb_agg(to_jsonb(t))
        from public.student_briefings t where t.student_id = p_student_id), '[]'::jsonb),
    'reminders', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at)
        from public.reminders t
       where t.student_id = p_student_id
          or t.emi_id in (select id from public.emi_schedule where student_id = p_student_id)
      ), '[]'::jsonb),
    -- cashfree_events survive the delete (their FK is ON DELETE SET NULL); we
    -- only remember which ones to re-link on restore.
    'cashfree_event_ids', coalesce((
      select jsonb_agg(t.id) from public.cashfree_events t where t.student_id = p_student_id), '[]'::jsonb)
  );

  -- Latest archive wins. Covers both re-archiving the same person and a second
  -- student created under the same email after the first was archived.
  delete from public.students_archive
   where id = p_student_id or lower(email) = lower(v_student.email);

  insert into public.students_archive (id, email, ghl_contact_id, first_name, last_name, snapshot, archived_by)
  values (p_student_id, v_student.email, v_student.ghl_contact_id,
          v_student.first_name, v_student.last_name, v_snapshot, p_actor);

  -- ORDER MATTERS. reminders.emi_id references emi_schedule with NO on-delete
  -- action, so a surviving reminder blocks the emi_schedule cascade and the
  -- whole delete fails. reminders first, then the rows whose FK has no cascade,
  -- then the student.
  delete from public.reminders
   where student_id = p_student_id
      or emi_id in (select id from public.emi_schedule where student_id = p_student_id);
  delete from public.weekly_checkpoints where student_id = p_student_id;

  -- Cascades from students: call_logs, emi_schedule, student_briefings.
  -- Nulled by their own FK: cashfree_events.student_id.
  -- The students_audit trigger records the delete with the full old row.
  delete from public.students where id = p_student_id;

  return p_student_id;
end;
$$;

comment on function public.archive_student(uuid, uuid) is
  'Move one student and every row belonging to them into students_archive, then hard-delete from the live tables. Returns the id, or null if the student did not exist.';

-- Batch wrapper — the delete API sends the whole selection in one call.
create or replace function public.archive_students(p_ids uuid[], p_actor uuid default null)
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
    if public.archive_student(v_id, p_actor) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ============================================================================
-- 3. restore_students(emails) — put them back, same UUID and all
-- ============================================================================
create or replace function public.restore_students(p_emails text[], p_actor uuid default null)
returns table (student_id uuid, email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  a          record;
  e          jsonb;
  v_student  jsonb;
  v_fallback uuid;
begin
  -- call_logs.coach_id is NOT NULL and references profiles. If the coach who
  -- logged a call has been removed since the student was archived, the call
  -- would be unrestorable — re-point it rather than lose the history.
  select coalesce(
    (select p.id from public.profiles p where p.id = p_actor),
    (select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1),
    (select p.id from public.profiles p order by p.created_at limit 1)
  ) into v_fallback;

  for a in
    select * from public.students_archive
     where lower(students_archive.email) in (select lower(x) from unnest(p_emails) x)
  loop
    -- Never resurrect on top of a live person. If someone re-created this
    -- student by hand, the live row wins and the archive is left untouched —
    -- restoring would violate students_email_uniq and silently merge two people.
    if exists (select 1 from public.students s
                where lower(s.email) = lower(a.email) and s.deleted_at is null)
       or exists (select 1 from public.students s where s.id = a.id) then
      continue;
    end if;

    v_student := a.snapshot->'student';

    -- ghl_contact_id is globally unique. A new contact may have claimed it
    -- while the student was archived; drop the link rather than abort the
    -- restore — the GHL import re-attaches it on the next sync.
    if v_student->>'ghl_contact_id' is not null
       and exists (select 1 from public.students s
                    where s.ghl_contact_id = v_student->>'ghl_contact_id') then
      v_student := v_student || jsonb_build_object('ghl_contact_id', null);
    end if;

    -- updated_by references profiles; the coach may be gone.
    if v_student->>'updated_by' is not null
       and not exists (select 1 from public.profiles p where p.id = (v_student->>'updated_by')::uuid) then
      v_student := v_student || jsonb_build_object('updated_by', null);
    end if;

    -- A restored student is active by definition.
    v_student := v_student || jsonb_build_object('deleted_at', null);

    insert into public.students
    select * from jsonb_populate_record(null::public.students, v_student);

    -- emi_schedule before reminders (reminders.emi_id references it).
    for e in select * from jsonb_array_elements(a.snapshot->'emi_schedule') loop
      insert into public.emi_schedule
      select * from jsonb_populate_record(null::public.emi_schedule, e);
    end loop;

    for e in select * from jsonb_array_elements(a.snapshot->'weekly_checkpoints') loop
      insert into public.weekly_checkpoints
      select * from jsonb_populate_record(null::public.weekly_checkpoints, e);
    end loop;

    for e in select * from jsonb_array_elements(a.snapshot->'call_logs') loop
      if not exists (select 1 from public.profiles p where p.id = (e->>'coach_id')::uuid) then
        e := e || jsonb_build_object('coach_id', v_fallback);
      end if;
      insert into public.call_logs
      select * from jsonb_populate_record(null::public.call_logs, e);
    end loop;

    -- Inserting call_logs fires call_logs_mark_briefing_stale, which creates a
    -- stub student_briefings row. Clear it so the archived briefing restores
    -- as-is instead of colliding on the primary key.
    delete from public.student_briefings where public.student_briefings.student_id = a.id;
    for e in select * from jsonb_array_elements(a.snapshot->'student_briefings') loop
      insert into public.student_briefings
      select * from jsonb_populate_record(null::public.student_briefings, e);
    end loop;

    for e in select * from jsonb_array_elements(a.snapshot->'reminders') loop
      -- recipient_profile / triggered_by reference profiles and are nullable.
      if e->>'recipient_profile' is not null
         and not exists (select 1 from public.profiles p where p.id = (e->>'recipient_profile')::uuid) then
        e := e || jsonb_build_object('recipient_profile', null);
      end if;
      if e->>'triggered_by' is not null
         and not exists (select 1 from public.profiles p where p.id = (e->>'triggered_by')::uuid) then
        e := e || jsonb_build_object('triggered_by', null);
      end if;
      insert into public.reminders
      select * from jsonb_populate_record(null::public.reminders, e);
    end loop;

    -- cashfree_events were never deleted, only unlinked.
    -- Compared as text on purpose: cashfree_events.id is bigserial in
    -- 0007_cashfree.sql but uuid on the live database, and casting to either
    -- one fails to plan on the other ("operator does not exist: uuid =
    -- bigint"). Text works for both and the id set here is tiny.
    update public.cashfree_events c
       set student_id = a.id
     where c.id::text in (select x from jsonb_array_elements_text(a.snapshot->'cashfree_event_ids') x);

    delete from public.students_archive where public.students_archive.id = a.id;

    student_id := a.id;
    email      := a.email;
    return next;
  end loop;
end;
$$;

comment on function public.restore_students(text[], uuid) is
  'Restore archived students by email, preserving their original UUID and every child row. Skips anyone whose email or id is already live. Returns the rows actually restored.';

-- ============================================================================
-- 4. Grants — server-side only (the API routes use the service-role key)
-- ============================================================================
revoke all on function public.archive_student(uuid, uuid)       from public, anon, authenticated;
revoke all on function public.archive_students(uuid[], uuid)    from public, anon, authenticated;
revoke all on function public.restore_students(text[], uuid)    from public, anon, authenticated;
grant execute on function public.archive_student(uuid, uuid)    to service_role;
grant execute on function public.archive_students(uuid[], uuid) to service_role;
grant execute on function public.restore_students(text[], uuid) to service_role;

-- ============================================================================
-- 5. Self-test — archive a throwaway student and restore them. Any failed
--    assertion aborts the migration, so a broken function is never deployed.
-- ============================================================================
do $$
declare
  v_id     uuid := gen_random_uuid();
  v_email  text := 'archive-selftest-' || replace(v_id::text, '-', '') || '@example.invalid';
  v_coach  uuid;
  v_emis   int;
  v_weeks  int;
  v_calls  int;
  v_arch   int;
begin
  select id into v_coach from public.profiles order by created_at limit 1;

  insert into public.students (id, email, first_name, last_name, membership)
  values (v_id, v_email, 'Archive', 'Selftest', 'Diamond');

  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date)
  values (v_id, 1, 2, 5000, current_date + 10, current_date + 7),
         (v_id, 2, 2, 5000, current_date + 40, current_date + 37);

  insert into public.weekly_checkpoints (student_id, week_no, completed)
  values (v_id, 1, true), (v_id, 2, true);

  -- call_logs.coach_id is NOT NULL; skip that leg on a database with no profiles yet.
  if v_coach is not null then
    insert into public.call_logs (student_id, coach_id, comment, outcome)
    values (v_id, v_coach, 'selftest call', 'connected');
  end if;

  -- ---- archive ----
  perform public.archive_student(v_id, null);

  if exists (select 1 from public.students where id = v_id) then
    raise exception 'archive_student: student row survived the archive';
  end if;
  select count(*) into v_emis  from public.emi_schedule       where student_id = v_id;
  select count(*) into v_weeks from public.weekly_checkpoints where student_id = v_id;
  select count(*) into v_calls from public.call_logs          where student_id = v_id;
  if v_emis <> 0 or v_weeks <> 0 or v_calls <> 0 then
    raise exception 'archive_student: children survived (emi=%, weeks=%, calls=%)', v_emis, v_weeks, v_calls;
  end if;
  select count(*) into v_arch from public.students_archive where id = v_id;
  if v_arch <> 1 then
    raise exception 'archive_student: expected 1 archive row, found %', v_arch;
  end if;

  -- ---- restore ----
  perform public.restore_students(array[v_email], null);

  if not exists (select 1 from public.students where id = v_id and deleted_at is null) then
    raise exception 'restore_students: student did not come back active';
  end if;
  select count(*) into v_emis  from public.emi_schedule       where student_id = v_id;
  select count(*) into v_weeks from public.weekly_checkpoints where student_id = v_id;
  select count(*) into v_calls from public.call_logs          where student_id = v_id;
  if v_emis <> 2 or v_weeks <> 2 or v_calls <> (case when v_coach is null then 0 else 1 end) then
    raise exception 'restore_students: children did not come back (emi=%, weeks=%, calls=%)', v_emis, v_weeks, v_calls;
  end if;
  if exists (select 1 from public.students_archive where id = v_id) then
    raise exception 'restore_students: archive row was not consumed';
  end if;

  -- ---- cleanup ----
  delete from public.reminders          where student_id = v_id;
  delete from public.weekly_checkpoints where student_id = v_id;
  delete from public.students           where id = v_id;
  delete from public.students_archive   where id = v_id;
  delete from public.audit_log          where entity_id = v_id;

  raise notice 'students_archive self-test passed';
end;
$$;

-- ============================================================================
-- 6. Backfill — move anyone already soft-deleted into the archive.
--
-- Runs after the self-test, so the functions are proven before they touch real
-- data. Without this the two mechanisms coexist: a legacy deleted_at row stays
-- in `students`, keeps leaking into any query that forgets the filter, and a
-- re-upload finds it by email and updates it WITHOUT clearing deleted_at — so
-- the student stays invisible. That is exactly the bug this migration exists to
-- fix, and it would have survived for everyone deleted before today.
-- ============================================================================
do $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.students where deleted_at is not null loop
    perform public.archive_student(r.id, null);
    n := n + 1;
  end loop;
  if n > 0 then
    raise notice 'students_archive: moved % previously soft-deleted student(s) into the archive', n;
  end if;
end;
$$;

-- Tell PostgREST to pick up the new table and functions.
notify pgrst, 'reload schema';
