# SQL tests

No test runner in this repo — these are plain psql scripts you point at a
throwaway Postgres. They cover `archive_student` / `restore_students`
(migration `0010_students_archive.sql`), which are the delete + re-upload path
for students.

```bash
docker run -d --name pgtest -e POSTGRES_PASSWORD=pg -p 55433:5432 postgres:15-alpine

# Supabase provides auth.users / auth.uid() / the anon+authenticated+service_role
# roles; _supabase_shim.sql is a minimal stand-in so the migrations apply on
# vanilla Postgres. It is a TEST FIXTURE — never run it against a real database.
psql ... -f supabase/tests/_supabase_shim.sql
psql ... -f supabase/migrations/0001_init.sql            # ...through 0010

psql ... -v ON_ERROR_STOP=1 -f supabase/tests/archive_edge_cases.sql
# expect: T1..T8 PASS, then "ALL EDGE-CASE TESTS PASSED"
```

The tests leave their fixtures behind, so run them on a scratch database.

Known: `0007_cashfree.sql` fails on a fresh database (`create or replace view
v_settings_status` renames an existing column, which Postgres rejects), and
`0008_vertex_provider.sql` then fails on the missing `ai_provider` column. Both
predate migration 0010. Drop the view first to get past it locally.
