-- ============================================================
-- Merge duplicate exercises (one-off cleanup) — APPLIED 2026-08-03, prod
--
-- Kept for the record. Do NOT re-run section 3; it is already done and the
-- remaining pairs turned out to be phantom (see below).
--
-- The candidate list came from a set-count query run WITHOUT a user filter, so
-- it mixed three accounts on the prod database. Only one duplicate was real:
--
--   custom:effe8e5b -> custom:ead062a9   "Inclined Dumbbell Press" x2, 1 set
--                                        moved (83 -> 84). REAL, applied.
--   bench_press                          11 sets, tester@fitlog.app. NOT ours.
--   chest_fly                            1 set,   tester@fitlog.app. NOT ours.
--   lat_pulldown                         1 set,   psd242@gmail.com.  NOT ours.
--
-- Lesson for next time: scope any cross-exercise audit by user_id. The app
-- itself is safe here — RLS is owner-only, so the in-app set counts that drive
-- the picker's duplicate-hiding only ever see your own rows.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PRE-CHECK (read-only) — same-day collisions
--
-- If a workout_date appears under BOTH keys of a pair, that session was logged
-- twice and merging stacks it into one inflated day. Expect zero rows. Any row
-- here = decide which copy to keep before merging that pair.
-- ------------------------------------------------------------
with pairs(from_key, to_key) as (
  values
    ('bench_press',                                    'custom:61e817a7-ed3e-456b-9bb2-aeab67e58341'),
    ('custom:effe8e5b-9618-4d6c-95f1-af6a165d718e',    'custom:ead062a9-9640-4168-9e9a-bd142e0fe012'),
    ('lat_pulldown',                                   'custom:12f2acc9-cb92-47d9-ba00-72094751de7b'),
    ('chest_fly',                                      'custom:96f1d0f6-ee03-4fbe-8d0a-43b0f47e08bd')
)
select p.from_key, p.to_key, w.workout_date, count(*) as sets_that_day
from pairs p
join public.workout_sets ws on ws.exercise_key in (p.from_key, p.to_key)
join public.workouts w on w.id = ws.workout_id
group by p.from_key, p.to_key, w.workout_date
having count(distinct ws.exercise_key) > 1
order by w.workout_date;

-- ------------------------------------------------------------
-- 2. The merge helper
--
-- Moves every reference from p_from to p_to for one user, then deletes the
-- source custom_exercises row if it was a custom. exercise_notes, form_videos
-- and strength_goals are unique(user_id, exercise_key) — a blind update would
-- violate that when both keys have a row, so the source row is dropped in that
-- case and the target's kept.
-- ------------------------------------------------------------
create or replace function public.merge_exercise(
  p_user uuid,
  p_from text,
  p_to   text
) returns integer
language plpgsql
as $$
declare
  v_name  text;
  v_moved integer;
begin
  if p_to like 'custom:%' then
    select name into v_name from public.custom_exercises
     where id = substring(p_to from 8)::uuid and user_id = p_user;
  else
    v_name := null;                        -- built-in target: keep existing names
  end if;

  update public.workout_sets
     set exercise_key = p_to, exercise_name = coalesce(v_name, exercise_name)
   where user_id = p_user and exercise_key = p_from;
  get diagnostics v_moved = row_count;

  update public.workout_exercises
     set exercise_key = p_to, exercise_name = coalesce(v_name, exercise_name)
   where user_id = p_user and exercise_key = p_from;

  update public.routine_exercises
     set exercise_key = p_to, exercise_name = coalesce(v_name, exercise_name)
   where user_id = p_user and exercise_key = p_from;

  delete from public.exercise_notes s
   where s.user_id = p_user and s.exercise_key = p_from
     and exists (select 1 from public.exercise_notes t
                  where t.user_id = p_user and t.exercise_key = p_to);
  update public.exercise_notes set exercise_key = p_to
   where user_id = p_user and exercise_key = p_from;

  delete from public.form_videos s
   where s.user_id = p_user and s.exercise_key = p_from
     and exists (select 1 from public.form_videos t
                  where t.user_id = p_user and t.exercise_key = p_to);
  update public.form_videos set exercise_key = p_to
   where user_id = p_user and exercise_key = p_from;

  delete from public.strength_goals s
   where s.user_id = p_user and s.exercise_key = p_from
     and exists (select 1 from public.strength_goals t
                  where t.user_id = p_user and t.exercise_key = p_to);
  update public.strength_goals
     set exercise_key = p_to, exercise_name = coalesce(v_name, exercise_name)
   where user_id = p_user and exercise_key = p_from;

  if p_from like 'custom:%' then
    delete from public.custom_exercises
     where id = substring(p_from from 8)::uuid and user_id = p_user;
  end if;

  return v_moved;
end;
$$;

-- ------------------------------------------------------------
-- 3. The merges
--
-- Set the email below to the account being cleaned up. Each call returns the
-- number of sets moved — compare against the comment on the right.
-- ------------------------------------------------------------
-- DONE — the only real duplicate. Ran 2026-08-03, moved 1 set.
--
-- begin;
-- select public.merge_exercise((select id from auth.users where email = 'soccernerd05@gmail.com'),
--   'custom:effe8e5b-9618-4d6c-95f1-af6a165d718e', 'custom:ead062a9-9640-4168-9e9a-bd142e0fe012');
-- commit;
--
-- The bench_press / chest_fly / lat_pulldown merges are NOT listed: those sets
-- belong to other accounts on the same database. They moved 0 rows and always
-- would have.
--
-- Still open, if you ever decide these are one lift each (both are yours):
--   overhead_tricep_ext -> custom:6eab1548…   4 sets, DB -> cable
--   db_curl             -> custom:b1196717…   4 sets, DB curl -> bicep curls

-- ------------------------------------------------------------
-- 4. VERIFY (read-only) — the four source keys must return no rows
-- ------------------------------------------------------------
select exercise_key, count(*) as sets_remaining
from public.workout_sets
where exercise_key in (
  'bench_press', 'lat_pulldown', 'chest_fly',
  'custom:effe8e5b-9618-4d6c-95f1-af6a165d718e'
)
group by exercise_key;

-- ------------------------------------------------------------
-- 5. CLEANUP
-- ------------------------------------------------------------
drop function if exists public.merge_exercise(uuid, text, text);

-- Optional — E2E test residue found in the set data (sentinel 1992 date).
-- Verify it really is test data before running.
--
-- delete from public.workout_sets      where exercise_key = 'custom:9b8559e4-f27a-463d-b20d-7248445c0703';
-- delete from public.workout_exercises where exercise_key = 'custom:9b8559e4-f27a-463d-b20d-7248445c0703';
-- delete from public.custom_exercises  where id = '9b8559e4-f27a-463d-b20d-7248445c0703';
