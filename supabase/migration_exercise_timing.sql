-- Move live-workout timing from per-set to per-exercise. Run in the Supabase
-- SQL editor. Tap Start on an exercise to stamp when you begin the first set;
-- Done stamps the end and rolls the exercise (or its whole superset block) into
-- the workout's "Completed" section. ended_at non-null = the exercise is done.
-- The old workout_sets.started_at / ended_at columns are now unused; they're
-- left in place so existing data isn't lost.
alter table public.workout_exercises
  add column if not exists started_at timestamptz,
  add column if not exists ended_at  timestamptz;
