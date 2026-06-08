-- ============================================================
-- exercise_notes — per-user form notes for an exercise.
-- exercise_key is a built-in slug (src/data/exercises.ts) or
-- 'custom:<uuid>'. Curated form cues ship in the app code
-- (src/data/exerciseForm.ts); this table holds the user's own
-- notes, shown alongside (and the only form content for custom
-- exercises). One row per user per exercise.
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
create table if not exists public.exercise_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_key text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_key)
);
alter table public.exercise_notes enable row level security;
drop policy if exists exercise_notes_rw_own on public.exercise_notes;
create policy exercise_notes_rw_own on public.exercise_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists exercise_notes_updated_at on public.exercise_notes;
create trigger exercise_notes_updated_at before update on public.exercise_notes
  for each row execute function public.set_updated_at();
