-- Batch / Group column for students.
--
-- Already written by the EMI Tracker / Master Sheet imports (via the "Group"
-- column → student_group) and read by the Profile tab. This migration makes
-- the column explicit so a fresh database has it, and so the "Batch / Group"
-- field on the Add Student form has somewhere to save to.
--
-- Safe to run repeatedly: uses IF NOT EXISTS.

alter table public.students
  add column if not exists student_group text;

comment on column public.students.student_group is 'Batch / cohort the student belongs to, e.g. "Batch A"';

-- Tell PostgREST (the Supabase API layer) to pick up the new column.
notify pgrst, 'reload schema';
