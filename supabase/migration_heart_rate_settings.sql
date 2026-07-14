-- Heart-rate settings: user's max HR + optional resting HR on the profile.
-- max_hr null   = estimate from age (Tanaka).
-- resting_hr set = zones use the Karvonen reserve; blank = plain %HRmax.
-- Run in the Supabase SQL Editor (the anon client can't do DDL). Idempotent.

alter table public.profiles add column if not exists max_hr smallint;
alter table public.profiles add column if not exists resting_hr smallint;
