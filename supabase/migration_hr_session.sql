-- Recorded heart-rate sessions: what a chest strap adds on top of the single
-- avg_hr/zone pair that migration_cardio_zones.sql introduced.
--   max_hr       — session peak, bpm
--   hr_samples   — the curve, jsonb { start, interval_s, bpm: [..] }; bpm is
--                  downsampled to one mean per interval_s seconds (5 by
--                  default, so an hour is ~720 numbers) and 0 marks a dropout
--   zone_seconds — real time-in-zone, seconds in zones 1..5, computed from the
--                  full-rate samples before downsampling
-- avg_hr and zone keep their meaning and are filled in from the recording, so
-- everything already reading them (zone trends, pace-at-zone, the weekly cardio
-- goal) works unchanged on recorded entries.
-- Run in the Supabase SQL Editor (the anon client can't do DDL). Idempotent.

alter table public.exercise_entries add column if not exists max_hr smallint;
alter table public.exercise_entries add column if not exists hr_samples jsonb;
alter table public.exercise_entries add column if not exists zone_seconds int[];
