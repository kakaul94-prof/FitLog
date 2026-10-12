-- ============================================================
-- Size limits on every free-text column.
--
-- Nothing capped how long a typed value could be. A 100 KB food name made the
-- API answer 500 with Postgres internals ("index row requires 60056 bytes,
-- maximum size is 8191"), and unindexed columns (notes, pain, names) simply
-- stored whatever arrived. Each text column now has a generous CHECK, so an
-- oversized value is refused with a clean 400 and never stored. Columns that
-- already allow only a fixed list of values (meal, source, sex...) are bounded
-- by that list and aren't touched.
-- Guarded by api-tests/tests/validation/test_payload_limits.py, including a
-- catalog test that fails if a new text column ships without a limit.
--
-- Run in Supabase -> SQL Editor (dev first, then prod). Safe to re-run.
-- It checks existing data first: if any row is already over a limit, it stops
-- before changing anything and names the column(s) to look at.
-- ============================================================

do $$
declare
  lim record;
  over bigint;
  problems text := '';
begin
  create temp table text_limits (tbl text, col text, max_chars int) on commit drop;
  insert into text_limits values
    -- Food names come from USDA / Open Food Facts too, so they get the most room.
    ('foods', 'name', 300), ('diary_entries', 'food_name', 300), ('meal_items', 'food_name', 300),
    -- Other names and labels a person types.
    ('foods', 'brand', 200), ('diary_entries', 'brand', 200), ('meal_items', 'brand', 200),
    ('meals', 'name', 200), ('routines', 'name', 200), ('workouts', 'name', 200),
    ('custom_exercises', 'name', 200), ('custom_activities', 'name', 200),
    ('exercise_entries', 'name', 200), ('workout_sets', 'pain', 200),
    ('routine_exercises', 'exercise_name', 200), ('workout_exercises', 'exercise_name', 200),
    ('workout_sets', 'exercise_name', 200), ('strength_goals', 'exercise_name', 200),
    -- Free-form notes.
    ('workouts', 'notes', 10000), ('workout_exercises', 'notes', 10000),
    ('exercise_notes', 'notes', 10000),
    -- Keys, units and codes the app writes.
    ('routine_exercises', 'exercise_key', 200), ('workout_exercises', 'exercise_key', 200),
    ('workout_sets', 'exercise_key', 200), ('strength_goals', 'exercise_key', 200),
    ('exercise_notes', 'exercise_key', 200), ('form_videos', 'exercise_key', 200),
    ('form_videos', 'storage_path', 500), ('foods', 'source_id', 100),
    ('foods', 'serving_unit', 100), ('diary_entries', 'serving_unit', 100),
    ('meal_items', 'serving_unit', 100), ('recipe_ingredients', 'unit', 100),
    ('custom_exercises', 'muscle', 100), ('custom_exercises', 'equipment', 100),
    ('measurements', 'type', 50), ('measurements', 'unit', 20), ('measurements', 'source', 50),
    ('profiles', 'weight_unit', 20), ('profiles', 'distance_unit', 20);

  -- 1. Pre-flight: nothing already stored may break a new limit.
  for lim in select * from text_limits loop
    execute format('select count(*) from public.%I where char_length(%I) > %s',
                   lim.tbl, lim.col, lim.max_chars) into over;
    if over > 0 then
      problems := problems || format(E'\n  %s.%s: %s row(s) longer than %s characters',
                                     lim.tbl, lim.col, over, lim.max_chars);
    end if;
  end loop;
  if problems <> '' then
    raise exception 'Not applied. Shorten these first (or raise the limit):%', problems;
  end if;

  -- 2. Add each limit once.
  for lim in select * from text_limits loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', lim.tbl)::regclass
        and conname = lim.tbl || '_' || lim.col || '_length'
    ) then
      execute format('alter table public.%I add constraint %I check (char_length(%I) <= %s)',
                     lim.tbl, lim.tbl || '_' || lim.col || '_length', lim.col, lim.max_chars);
    end if;
  end loop;
end $$;
