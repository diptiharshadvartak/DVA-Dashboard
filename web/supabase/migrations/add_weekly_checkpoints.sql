-- Weekly checkpoints — the source of truth for course progress.
--
-- The Progress tab reads/writes this table (4 weeks per month, 24 total) and
-- derives month completion from it; the Excel import also materializes weeks
-- from the Month 1..6 flags. The table was created directly in the dashboard
-- and never captured in a migration, so a fresh database would be missing it
-- and both the import and the Progress tab would fail with
-- "relation public.weekly_checkpoints does not exist".
--
-- Safe to run repeatedly: create/alter/policy statements are all guarded.

create table if not exists public.weekly_checkpoints (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students(id) on delete cascade,
  week_no     int  not null check (week_no >= 1),
  completed   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Required for the app's upsert(..., { onConflict: 'student_id,week_no' }).
  unique (student_id, week_no)
);

create index if not exists weekly_checkpoints_student
  on public.weekly_checkpoints (student_id);

-- RLS: same model as the other operational tables — authenticated coaches have
-- full read+write (see 0002_rls.sql).
alter table public.weekly_checkpoints enable row level security;
drop policy if exists "weekly_checkpoints rw" on public.weekly_checkpoints;
create policy "weekly_checkpoints rw" on public.weekly_checkpoints for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Tell PostgREST (the Supabase API layer) to pick up the new table.
notify pgrst, 'reload schema';
