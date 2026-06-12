-- Automatic reminder scheduling via pg_cron + pg_net.
--
-- Scheduling for the daily reminder sweep lives in the database (not Vercel Cron)
-- so it is reliable and self-contained. Cron jobs are DATABASE STATE — they are
-- NOT carried over by a normal schema/data move, so this migration recreates them
-- when the project is moved to a new Supabase account (e.g. the client's).
--
-- WHAT IT DOES
--   Every day at 03:30 UTC (= 09:00 IST) it calls
--     GET <app_base_url>/api/cron/daily-09
--   with an "Authorization: Bearer <cron_secret>" header. That endpoint runs the
--   "EMI reminder — 2 days before due" sweep (emi.reminder_due).
--
-- ====================================================================
-- ONE-TIME SETUP PER ENVIRONMENT  (run by hand with the REAL values for
-- that environment — these contain secrets, so do NOT commit them):
--
--   select vault.create_secret(
--     'https://YOUR-APP.vercel.app', 'app_base_url',
--     'Base URL of the deployed app, used by reminder cron jobs');
--
--   select vault.create_secret(
--     'YOUR-CRON-SECRET', 'cron_secret',
--     'Must equal the CRON_SECRET env var on the deployment; authorizes cron calls');
--
-- To rotate later:  select vault.update_secret(id, 'new value');  -- id from: select * from vault.secrets;
--
-- NOTE: the job is created regardless, but it only DOES anything once both vault
-- secrets exist — at run time the command reads them. If they are missing the
-- call resolves to a null URL and silently does nothing.
-- ====================================================================
--
-- Safe to run repeatedly: extensions use IF NOT EXISTS and the job is unscheduled
-- before being (re)created.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Recreate idempotently. cron.unschedule() raises if the job is absent, so guard it.
do $$
begin
  perform cron.unschedule('emi-reminders-daily-09');
exception when others then
  null;
end $$;

select cron.schedule(
  'emi-reminders-daily-09',
  '30 3 * * *',                                  -- 03:30 UTC = 09:00 IST, daily
  $job$
  select net.http_get(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
               || '/api/cron/daily-09',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $job$
);

-- The EMI-overdue (daily-10) and month-pending (end-of-month) sweeps are disabled
-- at the application level (reminder_events.enabled = false) and so are NOT
-- scheduled here. To enable later: set those events' workflow + enabled flags in
-- the app, then add jobs the same way, e.g.
--
--   select cron.schedule('emi-overdue-daily-10', '30 4 * * *', $job$
--     select net.http_get(
--       url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/cron/daily-10',
--       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--       timeout_milliseconds := 30000);
--   $job$);
--
--   select cron.schedule('course-month-pending-eom', '55 18 28-31 * *', $job$
--     select net.http_get(
--       url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/cron/end-of-month',
--       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--       timeout_milliseconds := 30000);
--   $job$);
--
-- Verify:  select jobid, jobname, schedule, active from cron.job;
-- History: select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
