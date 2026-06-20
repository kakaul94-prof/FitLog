-- ============================================================
-- strength_goals.target_date — optional target date for a strength goal.
-- Lets the Goals overview (/lift/goals) show a REQUIRED pace: the lb/week of
-- e1RM gain needed to reach target_1rm_lb by this date. Nullable — goals with
-- no date just show progress + the next-session suggestion.
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
alter table public.strength_goals
  add column if not exists target_date date;
