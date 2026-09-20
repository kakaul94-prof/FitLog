-- Time-budget workouts: mark a template's exercises as droppable.
--
-- When you start a session with less time than the template usually takes,
-- the trim ladder cuts sets off the OPTIONAL lifts first, then drops them
-- entirely, and only then shaves the core lifts. Everything defaults to core
-- (is_optional = false), so templates you never touch behave exactly as they
-- do today.
--
-- Idempotent — safe to re-run. Run in the Supabase SQL Editor on BOTH the dev
-- and prod projects.

alter table public.routine_exercises
  add column if not exists is_optional boolean not null default false;
