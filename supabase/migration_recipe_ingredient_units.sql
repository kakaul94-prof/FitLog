-- Per-ingredient measure for recipes: `amount` of `unit`, where unit is
-- 'base' (one of the ingredient food's base servings), a portion id, or a
-- mass unit (g/oz/lb). `servings` stays as the derived base-serving
-- multiplier for backward-compat. Idempotent — run in the Supabase SQL Editor.
alter table public.recipe_ingredients
  add column if not exists amount numeric,
  add column if not exists unit text;

-- Backfill existing rows: their old `servings` was a base-serving multiplier.
update public.recipe_ingredients
  set amount = servings, unit = 'base'
  where amount is null;
