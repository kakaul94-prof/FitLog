-- Per-muscle weekly set goals (sets/week target per body region).
-- Sparse jsonb keyed by RegionId (see src/data/bodyMap.ts); missing keys fall
-- back to DEFAULT_GOALS in app code. 0 = untracked (renders neutral on the map).
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists volume_targets jsonb;
