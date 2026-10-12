-- DVA Dashboard — stop the dashboard views leaking data to the public anon key
--
-- WHY
-- v_emi_overdue, v_emi_due_today, v_students_silent_30d and v_settings_status
-- were created without security_invoker, so they run as their owner (postgres)
-- and skip row level security. They were also granted to `anon`. The anon key
-- ships in the browser bundle, so anyone holding it could read
-- /rest/v1/v_emi_overdue and get student names, emails, mobiles and EMI amounts
-- without logging in. Supabase's Security Advisor flags all four as CRITICAL
-- ("Security Definer View").
--
-- WHAT
-- 1. security_invoker = true: the views now apply the caller's RLS, exactly
--    like v_student_list_aggregates already does. Every policy on the
--    underlying tables (students, emi_schedule, call_logs, ghl_settings)
--    allows any authenticated user to read, so logged-in coaches and admins
--    see the same rows as before, and the service-role key still sees all.
-- 2. anon loses all access; authenticated keeps read-only access (views are
--    never written to by the app).
--
-- NO APP CHANGE: every caller is either a logged-in session (layout, topbar,
-- settings pages) or the service-role client (cron / events), so results are
-- unchanged.

alter view public.v_emi_overdue          set (security_invoker = true);
alter view public.v_emi_due_today        set (security_invoker = true);
alter view public.v_students_silent_30d  set (security_invoker = true);
alter view public.v_settings_status      set (security_invoker = true);

revoke all on public.v_emi_overdue, public.v_emi_due_today,
              public.v_students_silent_30d, public.v_settings_status
  from public, anon, authenticated;

grant select on public.v_emi_overdue, public.v_emi_due_today,
                public.v_students_silent_30d, public.v_settings_status
  to authenticated;

grant all on public.v_emi_overdue, public.v_emi_due_today,
             public.v_students_silent_30d, public.v_settings_status
  to service_role;
