-- Adversarial tests for archive_student / restore_students.
-- Every block raises an exception on failure, so a clean run = all passed.

-- Two coaches (the on_auth_user_created trigger materializes profiles).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'coach1@t.invalid', '{"display_name":"Coach One","initials":"C1"}'),
  ('22222222-2222-2222-2222-222222222222', 'coach2@t.invalid', '{"display_name":"Coach Two","initials":"C2"}');
update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

-- ===========================================================================
-- TEST 1 — full round trip, including the nasty bits:
--   * a reminder with emi_id but NO student_id (blocks the emi cascade)
--   * a briefing that must survive the mark_briefing_stale trigger on restore
--   * cashfree_events, which are unlinked (not deleted) and must be re-linked
--   * restore keyed on a DIFFERENT-CASE email than the one stored
-- ===========================================================================
do $$
declare
  v_s    uuid := gen_random_uuid();
  v_e1   uuid; v_e2 uuid;
  v_cf   bigint;
  n      int;
  v_txt  text;
  v_tags text[];
begin
  insert into public.students (id, email, first_name, last_name, membership, ghl_contact_id, tags, total_fee)
  values (v_s, 'Round.Trip@T.invalid', 'Round', 'Trip', 'Diamond', 'GHL-ROUNDTRIP', array['diamond','vip'], 60000);

  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date, status)
  values (v_s, 1, 2, 30000, current_date + 5, current_date + 2, 'due_soon') returning id into v_e1;
  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date)
  values (v_s, 2, 2, 30000, current_date + 35, current_date + 32) returning id into v_e2;

  insert into public.weekly_checkpoints (student_id, week_no, completed)
  values (v_s, 1, true), (v_s, 2, true), (v_s, 3, false);

  insert into public.call_logs (student_id, coach_id, comment, outcome, next_action, next_action_due)
  values (v_s, '11111111-1111-1111-1111-111111111111', 'first call', 'connected', 'send fees link', current_date + 3),
         (v_s, '22222222-2222-2222-2222-222222222222', 'second call', 'no_answer', null, null);

  -- The call_logs trigger already created a stub briefing; make it real.
  update public.student_briefings
     set summary_md = 'THE REAL BRIEFING', is_stale = false, source_calls_count = 2, model = 'test-model'
   where student_id = v_s;

  insert into public.reminders (event_id, student_id, emi_id, channel, status, payload)
  values ('emi_due', v_s, v_e1, 'whatsapp', 'sent', '{"k":"v"}'::jsonb);
  -- student_id NULL on purpose: only emi_id ties it to this student. If
  -- archive_student misses it, reminders.emi_id (no ON DELETE) blocks the
  -- emi_schedule cascade and the whole archive fails.
  insert into public.reminders (event_id, student_id, emi_id, channel, status)
  values ('emi_due', null, v_e2, 'sms', 'queued');

  insert into public.cashfree_events (emi_id, student_id, event_type, cashfree_link_id)
  values (v_e1, v_s, 'link_created', 'LINK-1') returning id into v_cf;

  -- ---------------- archive ----------------
  perform public.archive_student(v_s, '11111111-1111-1111-1111-111111111111');

  if exists (select 1 from public.students where id = v_s) then
    raise exception 'T1: student survived archive';
  end if;
  select count(*) into n from public.emi_schedule where student_id = v_s;
  if n <> 0 then raise exception 'T1: % emi rows survived', n; end if;
  select count(*) into n from public.call_logs where student_id = v_s;
  if n <> 0 then raise exception 'T1: % call logs survived', n; end if;
  select count(*) into n from public.weekly_checkpoints where student_id = v_s;
  if n <> 0 then raise exception 'T1: % checkpoints survived', n; end if;
  select count(*) into n from public.student_briefings where student_id = v_s;
  if n <> 0 then raise exception 'T1: briefing survived'; end if;
  select count(*) into n from public.reminders where student_id = v_s or emi_id in (v_e1, v_e2);
  if n <> 0 then raise exception 'T1: % reminders survived', n; end if;
  -- cashfree_events must SURVIVE, unlinked
  select count(*) into n from public.cashfree_events where id = v_cf and student_id is null;
  if n <> 1 then raise exception 'T1: cashfree event was deleted instead of unlinked'; end if;
  select count(*) into n from public.students_archive where id = v_s;
  if n <> 1 then raise exception 'T1: expected 1 archive row, got %', n; end if;

  -- ---------------- restore, using a different-case email ----------------
  perform public.restore_students(array['ROUND.TRIP@t.INVALID'], '11111111-1111-1111-1111-111111111111');

  if not exists (select 1 from public.students where id = v_s and deleted_at is null) then
    raise exception 'T1: student did not come back (case-insensitive email match failed)';
  end if;
  select tags into v_tags from public.students where id = v_s;
  if not (v_tags @> array['diamond','vip']) then raise exception 'T1: tags lost, got %', v_tags; end if;
  select ghl_contact_id into v_txt from public.students where id = v_s;
  if v_txt <> 'GHL-ROUNDTRIP' then raise exception 'T1: ghl_contact_id lost, got %', v_txt; end if;

  select count(*) into n from public.emi_schedule where student_id = v_s;
  if n <> 2 then raise exception 'T1: expected 2 emis back, got %', n; end if;
  if not exists (select 1 from public.emi_schedule where id = v_e1 and amount = 30000 and status = 'due_soon') then
    raise exception 'T1: emi id/amount/status not preserved';
  end if;
  select count(*) into n from public.weekly_checkpoints where student_id = v_s;
  if n <> 3 then raise exception 'T1: expected 3 checkpoints back, got %', n; end if;
  select count(*) into n from public.call_logs where student_id = v_s;
  if n <> 2 then raise exception 'T1: expected 2 call logs back, got %', n; end if;
  if not exists (select 1 from public.call_logs
                  where student_id = v_s and coach_id = '22222222-2222-2222-2222-222222222222'
                    and comment = 'second call') then
    raise exception 'T1: call log coach attribution lost';
  end if;

  -- The briefing must be the REAL one, not the stub the trigger recreated.
  select summary_md into v_txt from public.student_briefings where student_id = v_s;
  if v_txt is distinct from 'THE REAL BRIEFING' then
    raise exception 'T1: briefing clobbered by mark_briefing_stale stub, got %', coalesce(v_txt,'<null>');
  end if;

  select count(*) into n from public.reminders where student_id = v_s or emi_id in (v_e1, v_e2);
  if n <> 2 then raise exception 'T1: expected 2 reminders back, got %', n; end if;
  if not exists (select 1 from public.reminders where emi_id = v_e2 and student_id is null) then
    raise exception 'T1: the student_id-less reminder was not restored faithfully';
  end if;

  select count(*) into n from public.cashfree_events where id = v_cf and student_id = v_s;
  if n <> 1 then raise exception 'T1: cashfree event was not re-linked'; end if;

  if exists (select 1 from public.students_archive where id = v_s) then
    raise exception 'T1: archive row not consumed';
  end if;

  raise notice 'T1 full round trip .......................... PASS';
end $$;

-- ===========================================================================
-- TEST 2 — archive → restore → archive again must not collide on the archive
--          table's PK or its lower(email) unique index.
-- ===========================================================================
do $$
declare v_s uuid; n int;
begin
  select id into v_s from public.students where email = 'Round.Trip@T.invalid';
  perform public.archive_student(v_s, null);
  perform public.restore_students(array['round.trip@t.invalid'], null);
  perform public.archive_student(v_s, null);
  select count(*) into n from public.students_archive where id = v_s;
  if n <> 1 then raise exception 'T2: expected 1 archive row after re-archive, got %', n; end if;
  raise notice 'T2 re-archive is idempotent ................. PASS';
end $$;

-- ===========================================================================
-- TEST 3 — a live student already holds the email: restore must SKIP, leaving
--          the archive intact rather than merging two different people.
-- ===========================================================================
do $$
declare v_new uuid := gen_random_uuid(); n int; v_ret int;
begin
  insert into public.students (id, email, first_name, membership)
  values (v_new, 'round.trip@t.invalid', 'Impostor', 'Diamond');

  select count(*) into v_ret from public.restore_students(array['round.trip@t.invalid'], null);
  if v_ret <> 0 then raise exception 'T3: restore returned % rows, should have skipped', v_ret; end if;
  select count(*) into n from public.students_archive where email ilike 'round.trip@t.invalid';
  if n <> 1 then raise exception 'T3: archive row was consumed despite the skip'; end if;
  if (select first_name from public.students where id = v_new) <> 'Impostor' then
    raise exception 'T3: live student was overwritten';
  end if;

  -- clear the way for later tests
  delete from public.students where id = v_new;
  raise notice 'T3 live email blocks restore ................ PASS';
end $$;

-- ===========================================================================
-- TEST 4 — another student has taken the archived ghl_contact_id. Restore must
--          still succeed, dropping the stale link instead of aborting.
-- ===========================================================================
do $$
declare v_thief uuid := gen_random_uuid(); v_s uuid; v_g text;
begin
  insert into public.students (id, email, first_name, membership, ghl_contact_id)
  values (v_thief, 'thief@t.invalid', 'Thief', 'Diamond', 'GHL-ROUNDTRIP');

  select student_id into v_s from public.restore_students(array['round.trip@t.invalid'], null);
  if v_s is null then raise exception 'T4: restore aborted on a taken ghl_contact_id'; end if;
  select ghl_contact_id into v_g from public.students where id = v_s;
  if v_g is not null then raise exception 'T4: expected ghl_contact_id to be dropped, got %', v_g; end if;

  delete from public.students where id = v_thief;
  raise notice 'T4 taken ghl_contact_id is dropped .......... PASS';
end $$;

-- ===========================================================================
-- TEST 5 — the coach who logged a call has since been removed. call_logs.coach_id
--          is NOT NULL, so restore must re-point rather than lose the history.
-- ===========================================================================
do $$
declare v_s uuid; n int; v_coach uuid;
begin
  select id into v_s from public.students where email ilike 'round.trip@t.invalid';
  perform public.archive_student(v_s, null);

  -- safe to remove now: the archive deleted the call_logs referencing them
  delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
  if exists (select 1 from public.profiles where id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'T5: fixture broken — profile was not cascaded away';
  end if;

  perform public.restore_students(array['round.trip@t.invalid'], '11111111-1111-1111-1111-111111111111');

  select count(*) into n from public.call_logs where student_id = v_s;
  if n <> 2 then raise exception 'T5: expected 2 call logs back, got %', n; end if;
  select coach_id into v_coach from public.call_logs where student_id = v_s and comment = 'second call';
  if v_coach <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'T5: orphaned call log not re-pointed to the actor, got %', v_coach;
  end if;
  raise notice 'T5 deleted coach is re-pointed .............. PASS';
end $$;

-- ===========================================================================
-- TEST 6 — batch archive: real ids counted, unknown ids skipped (not counted,
--          not an error).
-- ===========================================================================
do $$
declare v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); n int;
begin
  insert into public.students (id, email, first_name, membership) values
    (v_a, 'batch-a@t.invalid', 'BatchA', 'Diamond'),
    (v_b, 'batch-b@t.invalid', 'BatchB', 'Diamond');

  select public.archive_students(array[v_a, v_b, gen_random_uuid()], null) into n;
  if n <> 2 then raise exception 'T6: expected count 2, got %', n; end if;
  if exists (select 1 from public.students where id in (v_a, v_b)) then
    raise exception 'T6: batch left students behind';
  end if;

  -- restoring both in one call
  select count(*) into n from public.restore_students(array['batch-a@t.invalid','batch-b@t.invalid'], null);
  if n <> 2 then raise exception 'T6: expected 2 restored, got %', n; end if;
  raise notice 'T6 batch archive + batch restore ............ PASS';
end $$;

-- ===========================================================================
-- TEST 7 — archiving an id that does not exist returns null, no exception.
--          restore for an email that was never archived is a silent no-op.
-- ===========================================================================
do $$
declare v_r uuid; n int;
begin
  select public.archive_student(gen_random_uuid(), null) into v_r;
  if v_r is not null then raise exception 'T7: archive of a missing id returned %', v_r; end if;
  select count(*) into n from public.restore_students(array['nobody@t.invalid'], null);
  if n <> 0 then raise exception 'T7: restore of an unknown email returned % rows', n; end if;
  raise notice 'T7 missing ids are no-ops ................... PASS';
end $$;

-- ===========================================================================
-- TEST 8 — the reported UI bug: a deleted student must not leave EMI rows
--          behind for the EMI Tracker to pick up.
-- ===========================================================================
do $$
declare v_s uuid := gen_random_uuid(); n int;
begin
  insert into public.students (id, email, first_name, membership)
  values (v_s, 'uibug@t.invalid', 'UiBug', 'Diamond');
  insert into public.emi_schedule (student_id, installment_no, installments_total, amount, due_date, reminder_date)
  values (v_s, 1, 1, 12345, current_date + 3, current_date);

  perform public.archive_student(v_s, null);

  -- Exactly what web/app/(app)/emi/page.tsx queries.
  select count(*) into n
    from public.emi_schedule e join public.students s on s.id = e.student_id
   where s.deleted_at is null and e.amount = 12345;
  if n <> 0 then raise exception 'T8: deleted students EMI is still visible to the EMI Tracker'; end if;
  raise notice 'T8 deleted students EMIs are gone ........... PASS';
end $$;

select 'ALL EDGE-CASE TESTS PASSED' as result;
