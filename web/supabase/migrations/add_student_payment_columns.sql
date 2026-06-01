-- Fix: EMI Tracker import silently skipped rows that have a Down Payment.
--
-- The import writes payment-ledger fields onto the `students` table via
-- achievementFields() in app/api/students/import-emi-tracker/route.ts.
-- `full_payment_amount` / `full_payment_date` already existed (rows with a
-- Full Payment imported fine), but `downpayment_amount` / `downpayment_date`
-- did not — so any row with a Down Payment failed the insert/update with a
-- "column does not exist" error and was skipped.
--
-- Safe to run repeatedly: every column uses IF NOT EXISTS.

alter table public.students
  add column if not exists downpayment_amount  numeric,
  add column if not exists downpayment_date    date,
  add column if not exists full_payment_amount numeric,
  add column if not exists full_payment_date   date;

-- Tell PostgREST (the Supabase API layer) to pick up the new columns.
notify pgrst, 'reload schema';
