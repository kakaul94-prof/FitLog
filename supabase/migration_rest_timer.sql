-- ============================================================
-- Migration: per-workout rest timer duration (seconds)
-- Run this in Supabase → SQL Editor → Run. Safe to re-run.
-- ============================================================

alter table public.workouts
  add column if not exists rest_seconds integer not null default 90;
