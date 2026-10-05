-- Widen the strength set effort/RPE range from 1–5 to 1–10.
-- Run in the Supabase SQL editor. Drop-then-add is safe to re-run.
alter table public.workout_sets
  drop constraint if exists workout_sets_effort_check;
alter table public.workout_sets
  add constraint workout_sets_effort_check check (effort between 1 and 10);
