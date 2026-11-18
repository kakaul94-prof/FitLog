-- Dated step-goal history: jsonb array of { from (ISO date), goal }, e.g.
-- [{ "from": "2000-01-01", "goal": 10000 }, { "from": "2026-11-16", "goal": 8000 }].
-- Same shape and rules as calorie_goal_history: a past day shows the step goal
-- in effect on that day instead of the current one; today/future use the live
-- step_goal. Written from the Profile page (recordGoalChange in
-- src/lib/calc.ts). [] = nothing recorded yet.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists step_goal_history jsonb not null default '[]'::jsonb;
