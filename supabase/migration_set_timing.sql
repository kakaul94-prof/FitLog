-- Per-set wall-clock timing. Run in the Supabase SQL editor.
-- started_at / ended_at are stamped when you tap Start / Done on a set.
-- ended_at non-null = the set is done (used to roll an exercise into the
-- workout's "Completed" section once all its sets are ended).
alter table public.workout_sets
  add column if not exists started_at timestamptz,
  add column if not exists ended_at  timestamptz;
