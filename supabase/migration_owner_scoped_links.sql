-- ============================================================
-- Owner-scoped links: a row may only point at rows its own user owns.
--
-- Row-level security checks the owner of the row being written, but Postgres
-- checks a foreign key WITHOUT applying RLS. So a plain `references foods(id)`
-- let one user attach rows to another user's food, meal, routine or workout,
-- and the owner's later deletes then cascaded into (workout -> the other
-- user's sets) or were blocked by (food -> the other user's recipe) rows they
-- can't even see. Each link now includes user_id, so both rows must share an
-- owner. Guarded by api-tests/tests/validation/test_cross_user_references.py.
--
-- Run in Supabase -> SQL Editor (dev first, then prod). Safe to re-run.
-- Needs Postgres 15+ for `on delete set null (column)` (Supabase's default).
--
-- BEFORE running, check no cross-user links already exist (expect 0 rows;
-- if any appear, the matching constraint below would fail to add):
--
--   select 'diary_entries' as child, d.id from diary_entries d join foods f on f.id = d.food_id where f.user_id <> d.user_id
--   union all select 'meal_items.food', m.id from meal_items m join foods f on f.id = m.food_id where f.user_id <> m.user_id
--   union all select 'meal_items.meal', m.id from meal_items m join meals p on p.id = m.meal_id where p.user_id <> m.user_id
--   union all select 'recipe_ingredients.recipe', r.id from recipe_ingredients r join foods f on f.id = r.recipe_food_id where f.user_id <> r.user_id
--   union all select 'recipe_ingredients.ingredient', r.id from recipe_ingredients r join foods f on f.id = r.ingredient_food_id where f.user_id <> r.user_id
--   union all select 'routine_exercises', r.id from routine_exercises r join routines p on p.id = r.routine_id where p.user_id <> r.user_id
--   union all select 'workouts.routine', w.id from workouts w join routines p on p.id = w.source_routine_id where p.user_id <> w.user_id
--   union all select 'workout_exercises', e.id from workout_exercises e join workouts w on w.id = e.workout_id where w.user_id <> e.user_id
--   union all select 'workout_sets.workout', s.id from workout_sets s join workouts w on w.id = s.workout_id where w.user_id <> s.user_id
--   union all select 'workout_sets.exercise', s.id from workout_sets s join workout_exercises e on e.id = s.workout_exercise_id where e.user_id <> s.user_id;
-- ============================================================

-- 1. Every table that is linked to gets an (id, user_id) key to point at.
do $$
declare
  t text;
begin
  foreach t in array array['foods', 'meals', 'routines', 'workouts', 'workout_exercises'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', t)::regclass and conname = t || '_id_user_id_key'
    ) then
      execute format('alter table public.%I add constraint %I unique (id, user_id)',
                     t, t || '_id_user_id_key');
    end if;
  end loop;
end $$;

-- 2. Replace each one-column link with one that includes user_id. ON DELETE
--    behaviour is unchanged; "set null (col)" clears only the link, never user_id.
do $$
declare
  link record;
  old_fk text;
begin
  for link in
    select * from (values
      ('recipe_ingredients', 'recipe_food_id',      'foods',             'cascade'),
      ('recipe_ingredients', 'ingredient_food_id',  'foods',             'restrict'),
      ('diary_entries',      'food_id',             'foods',             'set null (food_id)'),
      ('meal_items',         'meal_id',             'meals',             'cascade'),
      ('meal_items',         'food_id',             'foods',             'set null (food_id)'),
      ('routine_exercises',  'routine_id',          'routines',          'cascade'),
      ('workouts',           'source_routine_id',   'routines',          'set null (source_routine_id)'),
      ('workout_exercises',  'workout_id',          'workouts',          'cascade'),
      ('workout_sets',       'workout_id',          'workouts',          'cascade'),
      ('workout_sets',       'workout_exercise_id', 'workout_exercises', 'cascade')
    ) as l(child, col, parent, on_delete)
  loop
    -- The old key, whatever it was named: a one-column foreign key on `col`.
    for old_fk in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.conrelid = format('public.%I', link.child)::regclass
        and cardinality(c.conkey) = 1
        and a.attname = link.col
    loop
      execute format('alter table public.%I drop constraint %I', link.child, old_fk);
    end loop;

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', link.child)::regclass
        and conname = link.child || '_' || link.col || '_owner_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I, user_id) '
        'references public.%I (id, user_id) on delete %s',
        link.child, link.child || '_' || link.col || '_owner_fkey', link.col,
        link.parent, link.on_delete);
    end if;
  end loop;
end $$;
