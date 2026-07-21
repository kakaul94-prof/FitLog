-- Dated calorie-goal history: jsonb array of { from (ISO date), goal }, e.g.
-- [{ "from": "2000-01-01", "goal": 2000 }, { "from": "2026-07-20", "goal": 1800 }].
-- A past diary day shows the goal in effect on that day instead of the current
-- one; today/future use the live goal. Written from the Profile page (see
-- recordGoalChange in src/lib/calc.ts). [] = nothing recorded yet.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists calorie_goal_history jsonb not null default '[]'::jsonb;
