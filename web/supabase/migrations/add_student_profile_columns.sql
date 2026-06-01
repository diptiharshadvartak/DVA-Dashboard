-- Student profile columns used by the app but never captured in a migration.
--
-- These are written by the Excel/Master imports and read/edited on the Profile
-- tab, but were added directly in the dashboard — so a fresh database would be
-- missing them and the import would fail with "column ... does not exist".
--
-- (student_group lives in add_student_group.sql; the down/full payment columns
-- in add_student_payment_columns.sql; total_fee/down_payment in 0006.)
--
-- Safe to run repeatedly: every column uses IF NOT EXISTS.

alter table public.students
  add column if not exists alternate_number  text,
  add column if not exists profile_link      text,
  add column if not exists course_start_date date,
  add column if not exists course_end_date   date,
  add column if not exists dipti_comments    text;

comment on column public.students.alternate_number  is 'Secondary phone number';
comment on column public.students.profile_link      is 'External profile / portfolio URL';
comment on column public.students.course_start_date is 'Course start (separate from enrollment start_date)';
comment on column public.students.course_end_date   is 'Course end (separate from enrollment end_date)';
comment on column public.students.dipti_comments    is 'Dipti maam''s personal notes about the student';

-- Tell PostgREST (the Supabase API layer) to pick up the new columns.
notify pgrst, 'reload schema';
