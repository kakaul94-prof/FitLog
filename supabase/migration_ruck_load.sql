-- Added weight (ruck plate / vest / pack) carried during a cardio entry, in lb.
-- Folded into the calorie estimate as extra body mass (see effectiveWeightLb in
-- calc.ts). Null = no load, which is every entry logged before this migration.
-- Run in the Supabase SQL Editor for BOTH the dev and prod projects.
alter table public.exercise_entries add column if not exists load_lb numeric;
