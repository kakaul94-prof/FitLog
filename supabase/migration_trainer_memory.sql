-- Trainer memory: durable facts the Ask-a-trainer chat carries between sessions
-- (e.g. "left knee gets cranky above 80% on squats", "responds well to paused
-- reps"). Array of { id, text, created_at }; empty = the trainer only sees your
-- live training stats. Distinct from coach_enabled, which gates the per-set
-- coach on the workout page.
alter table public.profiles
  add column if not exists trainer_memory jsonb not null default '[]'::jsonb;
