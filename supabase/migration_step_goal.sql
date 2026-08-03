-- Daily step goal. Plain integer; null = no goal set, in which case the diary
-- card shows the Health Connect step count on its own (as before). Set in
-- Profile & Goals → Steps.
-- Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists step_goal integer;
