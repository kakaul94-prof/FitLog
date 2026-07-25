-- Cardio in workout templates + weekly cardio volume target.
-- Run in the Supabase SQL Editor (dev AND prod) BEFORE using the feature:
-- saving a template with a cardio item / setting the weekly target will
-- error until these columns exist. Idempotent.

-- Cardio prescription on a template item (rows with exercise_key 'cardio:<activity>').
-- All nullable; lift rows leave them null.
alter table public.routine_exercises
  add column if not exists target_duration_min numeric,
  add column if not exists target_distance_mi numeric,
  add column if not exists target_zone smallint,
  add column if not exists intervals jsonb;
alter table public.routine_exercises drop constraint if exists routine_ex_target_zone_check;
alter table public.routine_exercises add constraint routine_ex_target_zone_check
  check (target_zone is null or (target_zone between 1 and 5));

-- Weekly cardio minutes target (Progress -> Cardio "This week" card). null = unset.
alter table public.profiles
  add column if not exists weekly_cardio_min_target integer;
