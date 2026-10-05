-- Health Connect weight sync: mark where a measurement row came from.
-- 'healthconnect' = imported from Health Connect; null = logged manually.
-- Run in the Supabase SQL Editor (dev + prod).
alter table public.measurements add column if not exists source text;
