-- ============================================================
-- Migration: per-template rest timer duration (seconds)
-- Each workout started from a template seeds its rest timer from this;
-- "Update template" on Done writes the workout's timer back.
-- Run this in Supabase → SQL Editor → Run. Safe to re-run.
-- ============================================================

alter table public.routines
  add column if not exists rest_seconds integer not null default 90;
