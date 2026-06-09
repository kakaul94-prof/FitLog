-- ============================================================
-- Migration: workout "Done" flag (skip the save/discard prompt)
-- Run this in Supabase → SQL Editor → Run. Safe to re-run.
--
-- Adding the column with default true backfills every existing
-- workout as completed (so revisiting them never prompts), then
-- the default flips to false so new workouts start in-progress
-- until you press Done.
-- ============================================================

alter table public.workouts
  add column if not exists completed boolean not null default true;
alter table public.workouts
  alter column completed set default false;
