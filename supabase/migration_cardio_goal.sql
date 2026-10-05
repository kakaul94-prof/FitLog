-- Weekly cardio goal: per-intensity minutes/week targets.
-- jsonb shaped { mode: 'simple' | 'zones', light, heavy, zones: [z1..z5] }
-- (see CardioGoal in src/lib/database.types.ts). null = no goal saved yet, in
-- which case the older single weekly_cardio_min_target still applies and seeds
-- the first save. Progress → Cardio and the Program page both read it.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists cardio_goal jsonb;
