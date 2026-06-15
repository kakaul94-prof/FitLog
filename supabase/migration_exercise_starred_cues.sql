-- ============================================================
-- exercise_notes.starred_cues — per-user favourited curated cues.
-- Curated form cues (Setup / Execution / Common mistakes) ship in
-- app code (src/data/exerciseForm.ts). This jsonb array holds the
-- exact cue strings the user has long-pressed to star as especially
-- helpful for one exercise; the UI shows a star next to them.
-- Default '[]' = nothing starred.
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
alter table public.exercise_notes
  add column if not exists starred_cues jsonb not null default '[]'::jsonb;
