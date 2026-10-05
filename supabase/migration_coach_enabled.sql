-- Next-set coach opt-in. Off by default: the workout page's Coach pill turns on
-- the feedback chips, today's plan line, the last-session warning and the coach
-- card. Existing feel/pain data is untouched when it's off — just not shown.
alter table public.profiles
  add column if not exists coach_enabled boolean not null default false;
