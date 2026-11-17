-- Treadmill incline (% grade, as the console shows it) for a cardio entry.
-- Treadmill walks are priced by the ACSM walking equation from speed
-- (distance ÷ duration) and this grade — see treadmillWalkEstimate in calc.ts;
-- the resolved MET is snapshotted into exercise_entries.met at save time.
-- Set (0 = flat) on every treadmill walk saved from this version on; null on
-- older entries and on activities without an incline.
-- Run in the Supabase SQL Editor for BOTH the dev and prod projects.
alter table public.exercise_entries add column if not exists incline_pct numeric;
