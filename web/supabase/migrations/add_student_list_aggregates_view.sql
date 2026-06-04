-- Aggregates for the Students list page: last call, last paid EMI (with mode),
-- and EMI status counts per student.
--
-- Replaces the per-student batched queries the Students page used to run
-- (chunks of 50 IDs swept three times over call_logs + emi_schedule), which
-- cost ~25 round-trips on every render. This view computes the same values in
-- a single query.
--
-- security_invoker = true makes the view run with the calling user's
-- permissions, so row visibility (RLS) on the underlying tables is identical to
-- the previous direct queries — no change in what any user can see.
create or replace view v_student_list_aggregates
with (security_invoker = true) as
select
  s.id as student_id,
  lc.last_call_at,
  lp.last_paid_date,
  lp.last_payment_mode,
  coalesce(ec.emi_total, 0)    as emi_total,
  coalesce(ec.emi_paid, 0)     as emi_paid,
  coalesce(ec.emi_overdue, 0)  as emi_overdue,
  coalesce(ec.emi_upcoming, 0) as emi_upcoming
from students s
left join lateral (
  -- Most recent call timestamp (formatted to relative time in app code).
  select max(cl.created_at) as last_call_at
  from call_logs cl
  where cl.student_id = s.id
) lc on true
left join lateral (
  -- Latest paid EMI that actually has a payment mode recorded — matches the old
  -- "first paid row (desc) with a non-null mode wins" logic.
  select e.paid_date as last_paid_date, e.payment_mode as last_payment_mode
  from emi_schedule e
  where e.student_id = s.id
    and e.status = 'paid'
    and e.paid_date is not null
    and e.payment_mode is not null
  order by e.paid_date desc
  limit 1
) lp on true
left join lateral (
  -- Status counts, mirroring the buckets the app builds client-side.
  select
    count(*)                                                    as emi_total,
    count(*) filter (where e.status = 'paid')                   as emi_paid,
    count(*) filter (where e.status = 'overdue')                as emi_overdue,
    count(*) filter (where e.status in ('upcoming', 'due_soon')) as emi_upcoming
  from emi_schedule e
  where e.student_id = s.id
) ec on true
where s.deleted_at is null;
