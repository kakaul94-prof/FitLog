-- ============================================================
-- Restore a backup in one transaction: all of it, or none of it.
--
-- The app used to restore a backup itself, over many requests: wipe each
-- table, then re-insert its rows. A failure part-way (lost signal, a row the
-- database refuses) left the account half-wiped and half-restored. This does
-- the same work inside one function call, which Postgres runs as a single
-- transaction, so any error undoes all of it.
--
-- SECURITY INVOKER: it runs as the signed-in user, so row-level security
-- applies exactly as for the app's own requests, and every restored row is
-- stamped with the caller's id. Only the backup tables listed below are ever
-- touched; any other key in the backup is ignored.
-- Guarded by api-tests/tests/resilience/test_restore_backup.py and the
-- "a restore that fails partway" tests in e2e/tests/backup.spec.ts.
--
-- Run in Supabase -> SQL Editor (dev first, then prod). Safe to re-run.
-- Until it's run, the app's Restore button reports an error and changes
-- nothing; everything else works as before.
-- ============================================================

create or replace function public.restore_backup(backup jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  -- Parents first: the order the app exports them in (exportData.ts TABLES).
  tables constant text[] := array[
    'profiles', 'foods', 'recipe_ingredients', 'diary_entries', 'meals', 'meal_items',
    'custom_activities', 'exercise_entries', 'custom_exercises', 'exercise_notes',
    'strength_goals', 'routines', 'routine_exercises', 'workouts', 'workout_exercises',
    'workout_sets', 'measurements'
  ];
  t text;
  tbl_rows jsonb;
  cols text;
begin
  if uid is null then
    raise exception 'restore_backup: sign in first' using errcode = '42501';
  end if;
  if jsonb_typeof(backup) is distinct from 'object' then
    raise exception 'restore_backup: a backup is an object of table rows' using errcode = '22023';
  end if;

  -- 1. Wipe, children first, each table the backup has. An older backup
  --    without a table leaves that table as it is. The profile (tables[1]) is
  --    kept and updated in place below.
  for i in reverse array_length(tables, 1) .. 2 loop
    t := tables[i];
    if jsonb_typeof(backup -> t) = 'array' then
      execute format('delete from public.%I where user_id = $1', t) using uid;
    end if;
  end loop;

  -- 2. Re-insert, parents first, keeping the backup's ids so links hold. Only
  --    columns the table has and the backup sets are written (the rest keep
  --    their defaults), and every row is stamped with the caller's id.
  foreach t in array tables loop
    tbl_rows := backup -> t;
    continue when jsonb_typeof(tbl_rows) is distinct from 'array'
               or jsonb_array_length(tbl_rows) = 0;

    if t = 'profiles' then
      select string_agg(format('%1$I = r.%1$I', a.attname), ', ')
        into cols
        from pg_attribute a
       where a.attrelid = 'public.profiles'::regclass
         and a.attnum > 0 and not a.attisdropped
         and a.attname <> 'id'
         and jsonb_typeof(tbl_rows -> 0) = 'object'
         and (tbl_rows -> 0) ? a.attname;
      if cols is not null then
        execute format(
          'update public.profiles p set %s '
          'from jsonb_populate_record(null::public.profiles, $1) r where p.id = $2', cols)
        using tbl_rows -> 0, uid;
      end if;
      continue;
    end if;

    -- A row that isn't an object makes jsonb_populate_recordset fail, which
    -- (like any other refused row) undoes the whole restore.
    tbl_rows := (select jsonb_agg(r || jsonb_build_object('user_id', uid))
                   from jsonb_array_elements(tbl_rows) r);
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass
       and a.attnum > 0 and not a.attisdropped
       and exists (select 1 from jsonb_array_elements(tbl_rows) r where r ? a.attname);
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)',
      t, cols)
    using tbl_rows;
  end loop;
end;
$$;

comment on function public.restore_backup(jsonb) is
  'Replace the caller''s data with a FitLog backup in one transaction (all or nothing).';

revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- Let the API see the new function straight away.
notify pgrst, 'reload schema';
