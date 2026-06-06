-- ============================================================
-- Migration: per-exercise workout rows (enables notes + supersets)
-- Run this in Supabase → SQL Editor → Run. Safe to re-run.
-- ============================================================

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_key text not null,
  exercise_name text not null,
  position integer not null default 0,
  notes text,
  superset_group integer,
  created_at timestamptz not null default now()
);
create index if not exists workout_ex_workout_idx on public.workout_exercises(workout_id);
alter table public.workout_exercises enable row level security;
drop policy if exists workout_ex_rw_own on public.workout_exercises;
create policy workout_ex_rw_own on public.workout_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- link each set to its exercise instance
alter table public.workout_sets
  add column if not exists workout_exercise_id uuid
  references public.workout_exercises(id) on delete cascade;
create index if not exists workout_sets_we_idx
  on public.workout_sets(workout_exercise_id);

-- supersets remembered in templates
alter table public.routine_exercises
  add column if not exists superset_group integer;
