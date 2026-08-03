-- Machine resistance level for a cardio entry, stored as the raw pair the user
-- read off the console (level 12 of 18). Vendor level scales aren't comparable,
-- so the burn comes from the FRACTION of max — see levelMet in calc.ts, which
-- is resolved into exercise_entries.met at save time and snapshotted there.
-- Run in the Supabase SQL Editor for BOTH the dev and prod projects.
alter table public.exercise_entries add column if not exists level smallint;
alter table public.exercise_entries add column if not exists level_max smallint;
