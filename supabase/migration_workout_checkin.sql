-- Pre-workout check-in: what hurt going in (site/side, sore vs sharp) and the
-- swaps/skips it led to. jsonb shaped { flags, swaps, skipped } (see
-- WorkoutCheckin in src/lib/database.types.ts). null = no check-in / all good.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.workouts
  add column if not exists checkin jsonb;
