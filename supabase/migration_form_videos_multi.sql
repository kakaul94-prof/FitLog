-- ============================================================
-- form_videos: keep up to 3 clips per exercise (was keep-last-1).
-- Drops the unique(user_id, exercise_key) constraint; the app caps
-- clips at 3 and asks which to replace once full. Existing clips
-- are untouched.
--
-- ORDER MATTERS: run this only AFTER the app version with multi-clip
-- support is live. The old app's upload relies on this constraint
-- (upsert on conflict) and fails without it.
-- Run in Supabase -> SQL Editor (dev, then prod). Safe to re-run.
-- ============================================================
alter table public.form_videos
  drop constraint if exists form_videos_user_id_exercise_key_key;

create index if not exists form_videos_exercise_idx
  on public.form_videos(user_id, exercise_key, created_at desc);

-- Check: should list only a 'p' (primary key) and 'f' (user fk) row — no 'u'.
select conname, contype from pg_constraint
 where conrelid = 'public.form_videos'::regclass;
