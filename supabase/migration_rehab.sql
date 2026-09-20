-- Rehab centre: injuries you open, work at a few times a week, rate now and
-- then, and close when they're better. One jsonb blob on the profile:
--   { "injuries": [ { id, site, side, note, started, status, resolved,
--                     aggravates: [exercise_key], plan: [ { id, name,
--                     targetPerWeek, holdSec } ] } ],
--     "log":      [ { id, injuryId, itemId, date, seconds } ],
--     "checkins": [ { id, injuryId, date, pain } ] }
-- Entries are tiny and the log is pruned to 52 weeks on save (lib/rehab.ts).
-- {} = nothing set up yet. Run in the Supabase SQL Editor. Idempotent.
alter table public.profiles
  add column if not exists rehab jsonb not null default '{}'::jsonb;
