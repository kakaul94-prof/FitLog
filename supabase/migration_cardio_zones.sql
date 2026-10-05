-- Cardio HR training zones: optional avg heart rate + zone (1–5) per cardio log.
-- Run in the Supabase SQL Editor (the anon client can't do DDL). Idempotent.

alter table public.exercise_entries add column if not exists avg_hr smallint;
alter table public.exercise_entries add column if not exists zone smallint;

alter table public.exercise_entries drop constraint if exists exercise_entries_zone_check;
alter table public.exercise_entries add constraint exercise_entries_zone_check
  check (zone is null or zone between 1 and 5);
