-- ============================================================
-- E2E seed data for the LOCAL Supabase stack only (`supabase start`).
-- Never run this against a hosted project. The passwords are throwaway
-- values for a disposable local database, not secrets.
--
-- Alice is the default account the browser tests sign in as; Bob owns rows
-- Alice must never see (row-level security). The others each own one area
-- with per-user state, so specs running in parallel can't collide:
--   Carol: program spec (the program is one record per user)
--   Dave:  routines spec (templates change what the Exercise tab shows)
--   Erin:  cardio + GPS specs (a fixed weight, since calorie estimates use it)
--   Frank: trainer spec (trainer memory is one record per user)
--   Grace: backup spec (restoring a backup wipes the account first)
--   Heidi: entries spec (edits and deletes diary entries and weigh-ins)
--   Ivan:  profile spec (goals and settings; also signs out, which ends every session)
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
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'carol@e2e.test', crypt('carol-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'dave@e2e.test', crypt('dave-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'erin@e2e.test', crypt('erin-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'frank@e2e.test', crypt('frank-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '77777777-0000-4000-8000-000000000007',
   'authenticated', 'authenticated', 'grace@e2e.test', crypt('grace-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '88888888-0000-4000-8000-000000000008',
   'authenticated', 'authenticated', 'heidi@e2e.test', crypt('heidi-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '99999999-0000-4000-8000-000000000009',
   'authenticated', 'authenticated', 'ivan@e2e.test', crypt('ivan-password', gen_salt('bf')),
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       now(), now(), now()
from auth.users
where email in ('alice@e2e.test', 'bob@e2e.test', 'carol@e2e.test', 'dave@e2e.test', 'erin@e2e.test',
                'frank@e2e.test', 'grace@e2e.test', 'heidi@e2e.test', 'ivan@e2e.test');

-- The on_auth_user_created trigger has already made the profiles rows.
-- Give Alice, Erin and Frank a fixed calorie goal so the diary (and the
-- trainer's snapshot) render deterministically.
update public.profiles
set calorie_goal_mode = 'manual', manual_calorie_goal = 2000
where id in ('aaaaaaaa-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000005',
             'ffffffff-0000-4000-8000-000000000006');

-- Erin (cardio + GPS specs) weighs exactly 80 kg, so calorie estimates are
-- known numbers. Dated long ago so it's her latest weigh-in for any test date.
insert into public.measurements (user_id, measured_on, type, value)
values ('eeeeeeee-0000-4000-8000-000000000005', '2000-01-01', 'weight', 176.37);

-- Frank (trainer spec) weighs 200 lb as of today: the trainer's snapshot only
-- reads recent weigh-ins.
insert into public.measurements (user_id, measured_on, type, value)
values ('ffffffff-0000-4000-8000-000000000006', current_date, 'weight', 200);

-- Bob's private data: the RLS spec asserts Alice can't read or change it.
insert into public.diary_entries (user_id, entry_date, meal, food_name, nutrients)
values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'lunch',
        'Bob''s private sandwich', '{"kcal": 450}');

insert into public.measurements (user_id, measured_on, type, value)
values ('bbbbbbbb-0000-4000-8000-000000000002', current_date, 'weight', 180);
