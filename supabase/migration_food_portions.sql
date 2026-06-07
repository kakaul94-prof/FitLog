-- Adds alternate serving units to foods: each portion carries a label, an
-- optional gram weight (so nutrition auto-scales from the base per-gram), and
-- an optional per-unit nutrient override. Idempotent — run in the Supabase
-- SQL Editor.
alter table public.foods
  add column if not exists portions jsonb not null default '[]'::jsonb;
