-- ============================================================
-- form_videos — per-user form-check video for one exercise.
-- exercise_key = built-in slug or 'custom:<uuid>'. "Keep last 1":
-- the unique(user_id, exercise_key) constraint means a new clip
-- REPLACES the previous one for that exercise (the app deletes the
-- old file on upload). The video itself lives in Storage; this row
-- only points at it (storage_path) plus light metadata.
-- Run in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================
create table if not exists public.form_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_key text not null,
  storage_path text not null,
  duration_sec integer,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (user_id, exercise_key)
);
create index if not exists form_videos_user_idx on public.form_videos(user_id);
alter table public.form_videos enable row level security;
drop policy if exists form_videos_rw_own on public.form_videos;
create policy form_videos_rw_own on public.form_videos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Storage: a PRIVATE bucket holding the video files. This is the
-- app's first use of Supabase Storage. Files are keyed by path
-- "<uid>/<exercise_key>/<uuid>.<ext>", so the first folder segment
-- is the owner's id; the policies below scope access to that folder.
-- 200 MB/file cap guards against runaway uploads (film ~20-30s @1080p).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('form-videos', 'form-videos', false, 209715200)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists form_videos_obj_select on storage.objects;
create policy form_videos_obj_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists form_videos_obj_insert on storage.objects;
create policy form_videos_obj_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists form_videos_obj_delete on storage.objects;
create policy form_videos_obj_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
