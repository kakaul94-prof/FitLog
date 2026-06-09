-- ============================================================
-- FitLog — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- Every table is owner-scoped via Row Level Security:
-- a user can only ever read/write rows where user_id = their id.
-- ============================================================

-- Helper: keep updated_at fresh on UPDATE
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- profiles (one row per user; auto-created on signup)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  sex text check (sex in ('male','female')),
  birth_date date,
  height_cm numeric,
  activity_level text not null default 'moderate'
    check (activity_level in ('sedentary','light','moderate','active','very_active')),
  weight_unit text not null default 'lb',
  distance_unit text not null default 'mi',
  goal_type text not null default 'maintain'
    check (goal_type in ('lose','maintain','gain')),
  goal_rate_lb_per_week numeric not null default 0,
  goal_weight_lb numeric,
  calorie_goal_mode text not null default 'calculated'
    check (calorie_goal_mode in ('calculated','manual')),
  manual_calorie_goal integer,
  macro_targets jsonb not null default
    '{"protein":{"mode":"g_per_lb","value":0.9},"fat":{"mode":"pct","value":30},"carb":{"mode":"remainder"}}'::jsonb,
  eat_back_exercise boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists profiles_rw_own on public.profiles;
create policy profiles_rw_own on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- foods — unified food library (copy-on-save).
-- Recipes are also stored here with source='recipe'.
-- nutrients = per-serving amounts keyed by nutrient code.
-- ============================================================
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  source text not null default 'manual' check (source in ('usda','manual','recipe')),
  source_id text,                       -- e.g. USDA fdcId, for dedupe / re-pull
  serving_qty numeric not null default 1,
  serving_unit text not null default 'serving',
  serving_grams numeric,                -- grams per serving when known (unit conversions)
  recipe_servings numeric,              -- yield; only set when source='recipe'
  nutrients jsonb not null default '{}'::jsonb,
  portions jsonb not null default '[]'::jsonb,  -- alternate serving units (label, grams, optional nutrient override)
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists foods_user_idx on public.foods(user_id);
create index if not exists foods_user_name_idx on public.foods(user_id, name);
alter table public.foods enable row level security;
drop policy if exists foods_rw_own on public.foods;
create policy foods_rw_own on public.foods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists foods_updated_at on public.foods;
create trigger foods_updated_at before update on public.foods
  for each row execute function public.set_updated_at();

-- ============================================================
-- recipe_ingredients — links a recipe food to its ingredient foods
-- ============================================================
create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_food_id uuid not null references public.foods(id) on delete cascade,
  ingredient_food_id uuid not null references public.foods(id) on delete restrict,
  servings numeric not null default 1,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists recipe_ing_recipe_idx on public.recipe_ingredients(recipe_food_id);
alter table public.recipe_ingredients enable row level security;
drop policy if exists recipe_ing_rw_own on public.recipe_ingredients;
create policy recipe_ing_rw_own on public.recipe_ingredients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- diary_entries — logged food. Nutrients are SNAPSHOTTED at log
-- time so past days never change if a food is later edited/deleted.
-- ============================================================
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  meal text not null default 'breakfast'
    check (meal in ('breakfast','lunch','dinner','snacks')),
  food_id uuid references public.foods(id) on delete set null,
  food_name text not null,
  brand text,
  servings numeric not null default 1,
  serving_qty numeric,
  serving_unit text,
  nutrients jsonb not null default '{}'::jsonb,   -- per-serving snapshot
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists diary_user_date_idx on public.diary_entries(user_id, entry_date);
alter table public.diary_entries enable row level security;
drop policy if exists diary_rw_own on public.diary_entries;
create policy diary_rw_own on public.diary_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- custom_activities — user-added cardio activities (built-ins
-- live in the app code). exercise_entries = the cardio log.
-- ============================================================
create table if not exists public.custom_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  met numeric not null default 5,
  distance_based boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.custom_activities enable row level security;
drop policy if exists custom_act_rw_own on public.custom_activities;
create policy custom_act_rw_own on public.custom_activities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.exercise_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  name text not null,
  met numeric,
  duration_min numeric,
  distance_mi numeric,
  calories integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists exercise_user_date_idx on public.exercise_entries(user_id, entry_date);
alter table public.exercise_entries enable row level security;
drop policy if exists exercise_rw_own on public.exercise_entries;
create policy exercise_rw_own on public.exercise_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Strength training
-- ============================================================
create table if not exists public.custom_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  muscle text,
  equipment text,
  type text not null default 'weighted'
    check (type in ('weighted','bodyweight','timed','cardio')),
  created_at timestamptz not null default now()
);
alter table public.custom_exercises enable row level security;
drop policy if exists custom_ex_rw_own on public.custom_exercises;
create policy custom_ex_rw_own on public.custom_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.routines enable row level security;
drop policy if exists routines_rw_own on public.routines;
create policy routines_rw_own on public.routines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists routines_updated_at on public.routines;
create trigger routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

create table if not exists public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid not null references public.routines(id) on delete cascade,
  exercise_key text not null,           -- built-in slug or 'custom:<uuid>'
  exercise_name text not null,
  position integer not null default 0,
  target_sets integer,
  target_reps integer
);
create index if not exists routine_ex_routine_idx on public.routine_exercises(routine_id);
alter table public.routine_exercises enable row level security;
drop policy if exists routine_ex_rw_own on public.routine_exercises;
create policy routine_ex_rw_own on public.routine_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_date date not null,
  name text,
  source_routine_id uuid references public.routines(id) on delete set null,
  notes text,
  rest_seconds integer not null default 90,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.workouts add column if not exists rest_seconds integer not null default 90;
-- "Done" flag: existing workouts predate it, so backfill them as completed
-- (default true on add), then make new workouts start in-progress (false).
alter table public.workouts add column if not exists completed boolean not null default true;
alter table public.workouts alter column completed set default false;
create index if not exists workouts_user_date_idx on public.workouts(user_id, workout_date);
alter table public.workouts enable row level security;
drop policy if exists workouts_rw_own on public.workouts;
create policy workouts_rw_own on public.workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_key text not null,
  exercise_name text not null,
  set_number integer not null default 1,
  reps numeric,
  weight_lb numeric,
  duration_sec numeric,
  distance numeric,
  effort integer check (effort between 1 and 5),
  is_warmup boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists workout_sets_workout_idx on public.workout_sets(workout_id);
create index if not exists workout_sets_ex_idx on public.workout_sets(user_id, exercise_key);
alter table public.workout_sets enable row level security;
drop policy if exists workout_sets_rw_own on public.workout_sets;
create policy workout_sets_rw_own on public.workout_sets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- measurements — body weight (type='weight') + optional others
-- ============================================================
create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  type text not null default 'weight',
  value numeric not null,
  unit text not null default 'lb',
  created_at timestamptz not null default now()
);
create index if not exists measurements_user_type_idx
  on public.measurements(user_id, type, measured_on);
alter table public.measurements enable row level security;
drop policy if exists measurements_rw_own on public.measurements;
create policy measurements_rw_own on public.measurements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- workout_exercises (per-exercise instance in a session: notes, supersets)
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

alter table public.workout_sets
  add column if not exists workout_exercise_id uuid
  references public.workout_exercises(id) on delete cascade;
create index if not exists workout_sets_we_idx
  on public.workout_sets(workout_exercise_id);

alter table public.routine_exercises
  add column if not exists superset_group integer;

-- ============================================================
-- exercise_notes — per-user form notes for an exercise.
-- exercise_key = built-in slug or 'custom:<uuid>'. Curated form
-- cues ship in app code (src/data/exerciseForm.ts); this holds
-- the user's own notes. One row per user per exercise.
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

-- ============================================================
-- meals + meal_items — named, reusable bundles of foods.
-- Distinct from recipes: a recipe collapses ingredients into ONE
-- food; a saved meal logs several SEPARATE diary rows in one tap
-- (each item stays individually editable). meal_items SNAPSHOT
-- each food (same shape as a diary row) at save time.
-- ============================================================
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meals_user_idx on public.meals(user_id);
alter table public.meals enable row level security;
drop policy if exists meals_rw_own on public.meals;
create policy meals_rw_own on public.meals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists meals_updated_at on public.meals;
create trigger meals_updated_at before update on public.meals
  for each row execute function public.set_updated_at();

create table if not exists public.meal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meal_id uuid not null references public.meals(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null,
  food_name text not null,
  brand text,
  servings numeric not null default 1,
  serving_qty numeric,
  serving_unit text,
  nutrients jsonb not null default '{}'::jsonb,   -- per-serving snapshot
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists meal_items_meal_idx on public.meal_items(meal_id);
alter table public.meal_items enable row level security;
drop policy if exists meal_items_rw_own on public.meal_items;
create policy meal_items_rw_own on public.meal_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Done. All tables have RLS enabled with owner-only access.
-- ============================================================
