-- ============================================================
-- exercise_notes.hidden_cues — per-user dismissed curated cues.
-- Curated form cues (Setup / Execution / Common mistakes) ship in
-- app code (src/data/exerciseForm.ts). This jsonb array holds the
-- exact cue strings the user has long-pressed to hide for one
-- exercise; the UI filters curated items against it and offers a
-- "Restore hidden cues" link. Default '[]' = nothing hidden.
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
alter table public.exercise_notes
  add column if not exists hidden_cues jsonb not null default '[]'::jsonb;
