-- How set effort is shown and picked: 'rpe' (1–10) or 'rir' (reps in reserve).
-- Display only — workout_sets.effort always stores RPE (RIR = 10 − RPE), so
-- switching never rewrites history. Run on dev AND prod.
alter table public.profiles
  add column if not exists effort_scale text not null default 'rpe'
  check (effort_scale in ('rpe', 'rir'));
