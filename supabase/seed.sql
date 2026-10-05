-- ============================================================
-- E2E seed data for the LOCAL Supabase stack only (`supabase start`).
-- Never run this against a hosted project. The passwords are throwaway
-- values for a disposable local database, not secrets.
--
-- Two users so the suite can prove row-level security: Alice is the
-- account the browser tests sign in as; Bob owns rows Alice must never see.
-- ============================================================

-- auth.users + auth.identities is what GoTrue writes on a real signup.
-- The token columns must be '' (not NULL) or GoTrue's sign-in scan fails.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'alice@e2e.test', crypt('alice-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'bob@e2e.test', crypt('bob-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       now(), now(), now()
from auth.users
where email in ('alice@e2e.test', 'bob@e2e.test');

-- The on_auth_user_created trigger has already made both profiles rows.
-- Give Alice a fixed calorie goal so the diary renders deterministically.
update public.profiles
set calorie_goal_mode = 'manual', manual_calorie_goal = 2000
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Bob's private data: the RLS spec asserts Alice can't read or change it.
insert into public.diary_entries (user_id, entry_date, meal, food_name, nutrients)
values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'lunch',
        'Bob''s private sandwich', '{"kcal": 450}');

insert into public.measurements (user_id, measured_on, type, value)
values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'weight', 180);
