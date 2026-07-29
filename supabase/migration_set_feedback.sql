-- Post-set feedback for the next-set coach (phase 1):
--   feel — movement quality: 'good' | 'off' (form broke down); null = not answered
--   pain — pain-site label ('shoulder', 'knee', 'low back', …); null = no pain
-- Run in the Supabase SQL Editor on BOTH dev and prod before using the feedback
-- chips (chip saves and workout undo-restore touch these columns). Idempotent.
alter table public.workout_sets
  add column if not exists feel text check (feel in ('good','off')),
  add column if not exists pain text;
