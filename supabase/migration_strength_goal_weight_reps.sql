-- ============================================================
-- strength_goals.target_weight_lb / target_reps — express a goal as a
-- weight × reps (e.g. 225 × 5), not just a bare 1RM. target_1rm_lb stays the
-- currency the progression engine runs on: it's DERIVED from these two via
-- Epley (estimated1RM) on save, so nothing downstream changes. A pure-1RM
-- goal is just target_reps = 1 (Epley returns the weight unchanged at 1 rep).
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
alter table public.strength_goals
  add column if not exists target_weight_lb numeric,
  add column if not exists target_reps integer not null default 1;

-- Backfill existing 1RM goals: weight = the stored 1RM, reps = 1.
update public.strength_goals
  set target_weight_lb = target_1rm_lb
  where target_weight_lb is null;

alter table public.strength_goals
  alter column target_weight_lb set not null;
