-- Workout program: the user's ordered rotation (templates + rest days) plus an
-- optional "next" override. Single jsonb on profiles (1 row/user), shape:
--   { "sequence": [ {"id":"..","kind":"routine","routineId":".."}
--                 | {"id":"..","kind":"rest"} ],
--     "nextOverride": "<routineId>" | null }
-- Sequential model — "next up" is derived from workout history over this order,
-- skipping rest. Empty/absent = no program yet (app falls back to template order).
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists program jsonb;
