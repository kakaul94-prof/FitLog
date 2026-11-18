-- Treadmill average speed (mph, as typed off the console) for a cardio entry.
-- When set it overrides distance ÷ duration as the speed the ACSM treadmill
-- estimate prices (treadmillWalkEstimate in calc.ts). Null = not entered.
-- Run in the Supabase SQL Editor for BOTH the dev and prod projects.
alter table public.exercise_entries add column if not exists speed_mph numeric;
