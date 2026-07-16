-- Daily supplements: foods taken every day (e.g. a multivitamin), folded into
-- the weekly Micronutrients rollup as if logged each day (NOT written to the
-- diary). jsonb array of { food_id, servings }; [] = none.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists daily_supplements jsonb not null default '[]'::jsonb;
