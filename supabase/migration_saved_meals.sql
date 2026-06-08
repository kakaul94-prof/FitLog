-- ============================================================
-- Saved Meals — named, reusable bundles of foods.
-- Distinct from recipes: a recipe collapses ingredients into ONE
-- food; a saved meal logs several SEPARATE diary rows in one tap,
-- so each item stays individually editable in the diary.
-- meal_items SNAPSHOT each food (same shape as a diary row) at
-- save time, so logging a meal is stable even if the source food
-- is later edited/deleted. Created from the diary's multi-select
-- "Save as meal"; logged from the food picker's "Meals" tab.
-- Run in Supabase → SQL Editor. Safe to re-run.
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
