-- Pre-workout fuel timing: the personal window offset learned from
-- post-workout "how did your stomach feel" feedback, plus the last meal timed.
-- jsonb shaped { offsetMin, last: { ateAt, kcal, earliestMin, latestMin } | null, log: [...] }
-- (see FuelTimingState in src/lib/database.types.ts). null = never used.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists fuel_timing jsonb;
