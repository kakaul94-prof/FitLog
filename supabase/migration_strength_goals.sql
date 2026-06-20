-- ============================================================
-- strength_goals — per-exercise strength goal + progression state.
-- One target 1RM per lift (exercise_key = built-in slug or
-- 'custom:<uuid>', one row per user+exercise). The app suggests the
-- next session's weight/reps toward target_1rm_lb using one of three
-- switchable methods:
--   linear  — add weight each session you hit the reps (Starting Strength)
--   double  — add reps across a range, then weight (NSCA 2-for-2)
--   531     — % of a training max in weekly waves (Wendler 5/3/1)
-- Current strength is NOT stored — it's derived live from logged
-- workout_sets (Epley e1RM), so switching method never resets progress.
-- tm_lb / cycle / week hold 5/3/1 state only (ignored by the others).
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================
create table if not exists public.strength_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_key text not null,
  exercise_name text not null,
  target_1rm_lb numeric not null,
  method text not null default 'double' check (method in ('linear', 'double', '531')),
  increment_lb numeric,
  rep_low integer not null default 5,
  rep_high integer not null default 8,
  sets integer not null default 3,
  tm_lb numeric,
  cycle integer not null default 1,
  week integer not null default 1,
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_key)
);
create index if not exists strength_goals_user_idx on public.strength_goals(user_id);
alter table public.strength_goals enable row level security;
drop policy if exists strength_goals_rw_own on public.strength_goals;
create policy strength_goals_rw_own on public.strength_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists strength_goals_updated_at on public.strength_goals;
create trigger strength_goals_updated_at before update on public.strength_goals
  for each row execute function public.set_updated_at();
