-- Performance indexes for the hot query paths the dashboard runs on every page
-- load. These change NO results — they only let Postgres satisfy the existing
-- WHERE / ORDER BY clauses with an index seek instead of a full table scan, so
-- they speed up navigation across the whole app as the tables grow.
--
-- All are IF NOT EXISTS so the migration is safe to re-run. They are written as
-- plain CREATE INDEX (not CONCURRENTLY) so they can run inside the migration
-- transaction; on a large existing table this briefly locks writes while the
-- index builds. If a table is very large and you need a zero-downtime build,
-- run the matching CREATE INDEX CONCURRENTLY by hand outside a transaction
-- instead.

-- ── emi_schedule ──────────────────────────────────────────────────────────
-- Status filters: overdue badge (layout, runs on every load), the EMI tab
-- buckets, and the Students "EMI overdue" count.
create index if not exists idx_emi_schedule_status
  on emi_schedule (status);

-- "Collected MTD / last month" sums filter status = 'paid' AND a paid_date
-- window. A composite index serves both the equality and the range together.
create index if not exists idx_emi_schedule_status_paid_date
  on emi_schedule (status, paid_date);

-- Reports filters due_date >= (last 6 months) and the EMI table orders by it.
create index if not exists idx_emi_schedule_due_date
  on emi_schedule (due_date);

-- Per-student lateral joins in v_student_list_aggregates and any per-student
-- EMI lookups.
create index if not exists idx_emi_schedule_student_id
  on emi_schedule (student_id);

-- ── call_logs ─────────────────────────────────────────────────────────────
-- "Most recent call per student" (Students aggregates view, Follow-ups,
-- Comments). Descending created_at makes "latest per student" a cheap lookup.
create index if not exists idx_call_logs_student_created
  on call_logs (student_id, created_at desc);

-- Reports filters created_at >= (last 12 weeks) across all students.
create index if not exists idx_call_logs_created_at
  on call_logs (created_at);

-- ── students ──────────────────────────────────────────────────────────────
-- Nearly every page filters deleted_at IS NULL and the roster orders by
-- created_at desc. A partial index on the live rows keeps it small and serves
-- both the filter and the sort.
create index if not exists idx_students_live_created_at
  on students (created_at desc)
  where deleted_at is null;

-- ── reminders ─────────────────────────────────────────────────────────────
-- Reports filters reminders created in the last 30 days.
create index if not exists idx_reminders_created_at
  on reminders (created_at);
