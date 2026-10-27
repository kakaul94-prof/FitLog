/**
 * What the FitLog frontend needs from Supabase (Auth + PostgREST), proven by
 * running the app's OWN code (supabase-js calls in src/) against a recording
 * stand-in, then written to contracts/fitlog-web--supabase.json for
 * contracts/provider/supabase.verify.test.ts to replay against a real stack.
 *
 * Each test: queue the call the app is expected to make and the example the
 * provider answers with, run the app code, check the app sent exactly that
 * request and read the example correctly. Nothing here touches the network.
 *
 * Covered: sign-in (and the 400 the login page shows), the current user,
 * logging a food entry (and the 409 replay case the offline queue relies on),
 * reading a day, editing and deleting entries, and the three reads behind the
 * diary's daily summary: entries, cardio calories and the profile's goal.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { Recorder } from '../support/recorder'
import { t } from '../support/schema'
import { fakeJwt } from '../support/jwt'
import { contractJson } from '../support/contractFile'
import type { JsonSchema } from '../support/types'
import type { DiaryEntry, ExerciseEntry, Food, Profile } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { fetchDiaryDay, registerDiaryMutationDefaults } from '@/features/diary/useDiary'
import { fetchExerciseEntries } from '@/features/exercise/useExercise'
import { fetchProfile, updateProfile } from '@/features/profile/useProfile'

// -- fixed values, so the contract file is stable from run to run ------------

const NOW = new Date('2026-10-21T12:00:00.000Z')
const DATE = '2026-10-21'
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const EMAIL = 'alice@contract.test'
const PASSWORD = 'contract-password-1'
const EXPIRES_AT = Math.floor(NOW.getTime() / 1000) + 3600
const ACCESS_TOKEN = fakeJwt({ sub: USER_ID, email: EMAIL, exp: EXPIRES_AT })
const ENTRY_1 = 'e0000000-0000-4000-8000-000000000001'
const ENTRY_2 = 'e0000000-0000-4000-8000-000000000002'
const FOOD_ID = 'f0000000-0000-4000-8000-000000000001'

// Only the clock: the app stamps created_at on new rows, and the session's
// expiry is judged against "now". Timers stay real.
vi.useFakeTimers({ toFake: ['Date'], now: NOW })

const recorder = new Recorder('supabase', {
  accessToken: ACCESS_TOKEN,
  anonKey: ANON_KEY,
  userId: USER_ID,
  email: EMAIL,
  password: PASSWORD,
})
recorder.install()
afterEach(() => recorder.verify())

// The diary writes are TanStack mutations registered as keyed defaults (so
// offline writes can resume after a restart). Running them through a bare
// QueryClient executes the exact mutationFn the app runs, React not required.
const qc = new QueryClient()
registerDiaryMutationDefaults(qc)
const mutate = (key: string, variables: unknown) =>
  qc.getMutationCache().build(qc, { mutationKey: ['diary', key] }).execute(variables)

const AUTH_HEADERS = { apikey: '{{anonKey}}', authorization: 'Bearer {{accessToken}}' }
const JSON_BODY = { 'content-type': 'application/json' }
const JSON_RESPONSE = { 'content-type': 'application/json' }
const SIGNED_IN = { name: 'a signed-in user' }

// -- examples, typed against the app's interfaces so the contract can't drift
//    from database.types.ts without this file failing to compile -----------

const USER = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: EMAIL,
  email_confirmed_at: '2026-10-01T09:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-21T11:00:00Z',
  is_anonymous: false,
}
const SESSION = {
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: EXPIRES_AT,
  refresh_token: 'contract-refresh-token',
  user: USER,
}

const FOOD: Food = {
  id: FOOD_ID,
  user_id: USER_ID,
  name: 'Greek yogurt',
  brand: 'Fage',
  source: 'manual',
  source_id: null,
  serving_qty: 170,
  serving_unit: 'g',
  serving_grams: 170,
  recipe_servings: null,
  nutrients: { kcal: 150, protein: 15, carb: 8, fat: 7 },
  portions: [],
  archived: false,
  created_at: '2026-10-01T09:00:00+00:00',
  updated_at: '2026-10-01T09:00:00+00:00',
}

const ENTRY: DiaryEntry = {
  id: ENTRY_1,
  user_id: USER_ID,
  entry_date: DATE,
  meal: 'lunch',
  food_id: FOOD_ID,
  food_name: 'Greek yogurt',
  brand: 'Fage',
  servings: 1.5,
  serving_qty: 170,
  serving_unit: 'g',
  nutrients: { kcal: 150, protein: 15, carb: 8, fat: 7 },
  position: 0,
  created_at: '2026-10-21T12:00:00+00:00',
}

const CARDIO: ExerciseEntry = {
  id: 'c0000000-0000-4000-8000-000000000001',
  user_id: USER_ID,
  entry_date: DATE,
  name: 'Walking',
  met: 3.5,
  duration_min: 30,
  distance_mi: 1.6,
  calories: 120,
  avg_hr: 112,
  zone: 2,
  max_hr: null,
  hr_samples: null,
  zone_seconds: null,
  load_lb: null,
  level: null,
  level_max: null,
  created_at: '2026-10-21T07:30:00+00:00',
}

const PROFILE: Profile = {
  id: USER_ID,
  sex: 'female',
  birth_date: '1994-05-02',
  height_cm: 168,
  activity_level: 'moderate',
  weight_unit: 'lb',
  distance_unit: 'mi',
  goal_type: 'lose',
  goal_rate_lb_per_week: 0.5,
  goal_weight_lb: 140,
  calorie_goal_mode: 'calculated',
  manual_calorie_goal: null,
  calorie_goal_history: [{ from: '2026-10-01', goal: 1850 }],
  macro_targets: {
    protein: { mode: 'g_per_lb', value: 0.9 },
    fat: { mode: 'pct', value: 30 },
    carb: { mode: 'remainder' },
  },
  volume_targets: null,
  daily_supplements: [],
  eat_back_exercise: false,
  max_hr: null,
  resting_hr: 58,
  step_goal: 8000,
  program: null,
  weekly_cardio_min_target: null,
  cardio_goal: null,
  coach_enabled: false,
  rehab: null,
  trainer_memory: [],
  fuel_timing: null,
  created_at: '2026-10-01T09:00:00+00:00',
  updated_at: '2026-10-20T18:00:00+00:00',
}

// -- the shapes the app reads --------------------------------------------------

const MEAL = t.oneOf('breakfast', 'lunch', 'dinner', 'snacks')
const NUTRIENTS: JsonSchema = { type: 'object', additionalProperties: { type: 'number' } }

const DIARY_ROW = t.object({
  id: t.uuid(),
  user_id: t.uuid(),
  entry_date: t.date(),
  meal: MEAL,
  food_id: t.nullable(t.uuid()),
  food_name: t.text(),
  brand: t.nullable(t.string()),
  servings: t.number(),
  serving_qty: t.nullable(t.number()),
  serving_unit: t.nullable(t.string()),
  nutrients: NUTRIENTS,
  position: t.number(),
  created_at: t.timestamp(),
})

/** The row the app inserts: the client chooses id + created_at (see newDiaryRow). */
const DIARY_INSERT = t.object(
  {
    id: t.uuid(),
    created_at: t.timestamp(),
    entry_date: t.date(),
    meal: MEAL,
    food_id: t.nullable(t.uuid()),
    food_name: t.text(),
    brand: t.nullable(t.string()),
    servings: t.number(),
    serving_qty: t.nullable(t.number()),
    serving_unit: t.nullable(t.string()),
    nutrients: NUTRIENTS,
  },
  { closed: true },
)
const INSERT_COLUMNS =
  '"id","created_at","entry_date","meal","food_id","food_name","brand","servings","serving_qty","serving_unit","nutrients"'

const CARDIO_ROW = t.object({
  id: t.uuid(),
  user_id: t.uuid(),
  entry_date: t.date(),
  name: t.text(),
  met: t.nullable(t.number()),
  duration_min: t.nullable(t.number()),
  distance_mi: t.nullable(t.number()),
  calories: t.number(),
  avg_hr: t.nullable(t.number()),
  zone: t.nullable(t.number()),
  max_hr: t.nullable(t.number()),
  hr_samples: t.nullable(t.json()),
  zone_seconds: t.nullable(t.array(t.number())),
  load_lb: t.nullable(t.number()),
  level: t.nullable(t.number()),
  level_max: t.nullable(t.number()),
  created_at: t.timestamp(),
})

const MACRO = t.object(
  { mode: t.oneOf('g', 'g_per_lb', 'pct', 'remainder'), value: t.number() },
  { optional: ['value'] },
)
const PROFILE_PROPS = {
  id: t.uuid(),
  sex: t.nullable(t.oneOf('male', 'female')),
  birth_date: t.nullable(t.date()),
  height_cm: t.nullable(t.number()),
  activity_level: t.oneOf('sedentary', 'light', 'moderate', 'active', 'very_active'),
  weight_unit: t.text(),
  distance_unit: t.text(),
  goal_type: t.oneOf('lose', 'maintain', 'gain'),
  goal_rate_lb_per_week: t.number(),
  goal_weight_lb: t.nullable(t.number()),
  calorie_goal_mode: t.oneOf('calculated', 'manual'),
  manual_calorie_goal: t.nullable(t.number()),
  calorie_goal_history: t.array(t.object({ from: t.date(), goal: t.number() })),
  macro_targets: t.object({ protein: MACRO, carb: MACRO, fat: MACRO }),
  volume_targets: t.nullable(t.json()),
  daily_supplements: t.array(t.object({ food_id: t.uuid(), servings: t.number() })),
  eat_back_exercise: t.boolean(),
  max_hr: t.nullable(t.number()),
  resting_hr: t.nullable(t.number()),
  step_goal: t.nullable(t.number()),
  program: t.nullable(t.json()),
  weekly_cardio_min_target: t.nullable(t.number()),
  cardio_goal: t.nullable(t.json()),
  coach_enabled: t.boolean(),
  rehab: t.nullable(t.json()),
  trainer_memory: t.array(t.object({ id: t.text(), text: t.text(), created_at: t.text() })),
  fuel_timing: t.nullable(t.json()),
  created_at: t.timestamp(),
  updated_at: t.timestamp(),
}
const PROFILE_ROW = t.object(PROFILE_PROPS)

test('the contract schemas list exactly the columns the app types', () => {
  // The examples are typed (DiaryEntry, ExerciseEntry, Profile), so TypeScript
  // guarantees they carry every column the app reads. This pins the schemas
  // to the same set: add a column to the interface and this fails until the
  // contract says what the provider must return.
  expect(Object.keys(DIARY_ROW.properties!).sort()).toEqual(Object.keys(ENTRY).sort())
  expect(Object.keys(CARDIO_ROW.properties!).sort()).toEqual(Object.keys(CARDIO).sort())
  expect(Object.keys(PROFILE_ROW.properties!).sort()).toEqual(Object.keys(PROFILE).sort())
})

// -- auth / session ----------------------------------------------------------------

describe('auth and session', () => {
  const tokenRequest = (body: JsonSchema) => ({
    method: 'POST' as const,
    path: '/auth/v1/token',
    query: { grant_type: 'password' },
    headers: {
      apikey: '{{anonKey}}',
      authorization: 'Bearer {{anonKey}}',
      'content-type': 'application/json;charset=UTF-8',
    },
    body,
  })
  const CREDENTIALS = t.object({ email: t.text(), password: t.text() })

  test('auth.sign-in-wrong-password: the login page shows the provider message', async () => {
    recorder.expect({
      id: 'auth.sign-in-wrong-password',
      description: 'Sign in with the wrong password',
      consumer: 'src/pages/LoginPage.tsx signInPassword(): shows error.message',
      providerStates: [{ name: 'the password is wrong' }],
      request: tokenRequest(CREDENTIALS),
      response: {
        status: 400,
        headers: JSON_RESPONSE,
        schema: t.object({ error_code: t.text(), msg: t.text() }),
        body: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
      },
    })

    const { data, error } = await supabase.auth.signInWithPassword({
      email: EMAIL,
      password: 'not-the-password',
    })

    expect(data.session).toBeNull()
    expect(error?.status).toBe(400)
    expect(error?.message).toBe('Invalid login credentials')
  })

  test('auth.sign-in: a session the rest of the app can use', async () => {
    recorder.expect({
      id: 'auth.sign-in',
      description: 'Sign in with email and password',
      consumer: 'src/pages/LoginPage.tsx signInPassword(); session read by src/lib/auth.tsx and apiHeaders()',
      providerStates: [SIGNED_IN],
      request: tokenRequest(CREDENTIALS),
      response: {
        status: 200,
        headers: JSON_RESPONSE,
        schema: t.object({
          access_token: t.text(),
          token_type: t.literal('bearer'),
          expires_in: t.number(),
          refresh_token: t.text(),
          user: t.object({ id: t.uuid(), email: t.text() }),
        }),
        body: SESSION,
      },
    })

    const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })

    expect(error).toBeNull()
    expect(data.user?.id).toBe(USER_ID)
    // What AuthProvider and apiHeaders() read back afterwards.
    const { data: later } = await supabase.auth.getSession()
    expect(later.session?.access_token).toBe(ACCESS_TOKEN)
    expect(later.session?.user.id).toBe(USER_ID)
  })

  test('auth.current-user: the user id the profile writes key on', async () => {
    recorder.expect(currentUser())
    const { data, error } = await supabase.auth.getUser()
    expect(error).toBeNull()
    expect(data.user?.id).toBe(USER_ID)
  })
})

function currentUser() {
  return {
    id: 'auth.current-user',
    description: 'Who is signed in',
    consumer: 'src/features/profile/useProfile.ts updateProfile(): user.id',
    providerStates: [SIGNED_IN],
    request: { method: 'GET' as const, path: '/auth/v1/user', headers: AUTH_HEADERS, body: null },
    response: {
      status: 200,
      headers: JSON_RESPONSE,
      schema: t.object({ id: t.uuid(), email: t.text() }),
      body: USER,
    },
  }
}

// -- the food diary ---------------------------------------------------------------

describe('diary entries', () => {
  const logFoodRequest = {
    method: 'POST' as const,
    path: '/rest/v1/diary_entries',
    query: { columns: INSERT_COLUMNS },
    headers: { ...AUTH_HEADERS, ...JSON_BODY },
    body: t.array(DIARY_INSERT),
  }
  const logFoodVars = { entry_date: DATE, meal: 'lunch', food: FOOD, servings: 1.5, id: ENTRY_1 }

  test('diary.log-food: a food is logged as a snapshot row the client identifies', async () => {
    recorder.expect({
      id: 'diary.log-food',
      description: 'Log a food to a meal',
      consumer: 'src/features/diary/useDiary.ts useLogFood() -> insertDiaryRows()',
      providerStates: [
        SIGNED_IN,
        { name: 'a food exists', params: { id: FOOD_ID } },
        { name: 'no diary entry', params: { id: ENTRY_1 } },
      ],
      request: logFoodRequest,
      response: { status: 201, headers: {}, schema: null, body: null },
    })

    await expect(mutate('logFood', logFoodVars)).resolves.toBeUndefined()
  })

  test('diary.log-food-already-saved: a replayed write is complete, not failed', async () => {
    // The offline queue can send an insert again after it already reached the
    // server; the app treats "duplicate key" + "all rows present" as success.
    recorder.expect({
      id: 'diary.log-food-already-saved',
      description: 'Re-send a food entry that already reached the server',
      consumer: 'src/features/diary/useDiary.ts insertDiaryRows(): reads error.code',
      providerStates: [
        SIGNED_IN,
        { name: 'a food exists', params: { id: FOOD_ID } },
        { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } },
      ],
      request: logFoodRequest,
      response: {
        status: 409,
        headers: JSON_RESPONSE,
        schema: t.object({ code: t.literal('23505'), message: t.text() }),
        body: {
          code: '23505',
          details: `Key (id)=(${ENTRY_1}) already exists.`,
          hint: null,
          message: 'duplicate key value violates unique constraint "diary_entries_pkey"',
        },
      },
    })
    recorder.expect({
      id: 'diary.confirm-entries-saved',
      description: 'Check which of the re-sent entries are already stored',
      consumer: 'src/features/diary/useDiary.ts insertDiaryRows()',
      providerStates: [SIGNED_IN, { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } }],
      request: {
        method: 'GET',
        path: '/rest/v1/diary_entries',
        query: { select: 'id', id: `in.(${ENTRY_1})` },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: {
        status: 200,
        headers: JSON_RESPONSE,
        schema: t.array(t.object({ id: t.uuid() })),
        body: [{ id: ENTRY_1 }],
      },
    })

    await expect(mutate('logFood', logFoodVars)).resolves.toBeUndefined()
  })

  test('diary.read-day: the rows the diary page renders', async () => {
    recorder.expect({
      id: 'diary.read-day',
      description: "Read one day's diary entries",
      consumer: 'src/features/diary/useDiary.ts useDiary() -> fetchDiaryDay()',
      providerStates: [SIGNED_IN, { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } }],
      request: {
        method: 'GET',
        path: '/rest/v1/diary_entries',
        query: { select: '*', entry_date: `eq.${DATE}`, order: 'created_at.asc' },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: { status: 200, headers: JSON_RESPONSE, schema: t.array(DIARY_ROW), body: [ENTRY] },
    })

    expect(await fetchDiaryDay(DATE)).toEqual([ENTRY])
  })

  test('diary.update-servings: change how much of a food was eaten', async () => {
    recorder.expect({
      id: 'diary.update-servings',
      description: "Change an entry's servings",
      consumer: 'src/features/diary/useDiary.ts useUpdateDiaryServings()',
      providerStates: [SIGNED_IN, { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } }],
      request: {
        method: 'PATCH',
        path: '/rest/v1/diary_entries',
        query: { id: `eq.${ENTRY_1}` },
        headers: { ...AUTH_HEADERS, ...JSON_BODY },
        body: t.object({ servings: t.number() }, { closed: true }),
      },
      response: { status: 204, headers: {}, schema: null, body: null },
    })

    await expect(mutate('updateServings', { id: ENTRY_1, servings: 2 })).resolves.toBeUndefined()
  })

  test('diary.update-entry: edit any of the fields the entry page offers', async () => {
    recorder.expect({
      id: 'diary.update-entry',
      description: 'Edit an entry (move it to another meal here)',
      consumer: 'src/features/diary/useDiary.ts useUpdateDiaryEntry()',
      providerStates: [SIGNED_IN, { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } }],
      request: {
        method: 'PATCH',
        path: '/rest/v1/diary_entries',
        query: { id: `eq.${ENTRY_1}` },
        headers: { ...AUTH_HEADERS, ...JSON_BODY },
        body: t.partial(DIARY_ROW.properties!),
      },
      response: { status: 204, headers: {}, schema: null, body: null },
    })

    await expect(mutate('updateEntry', { id: ENTRY_1, meal: 'dinner' })).resolves.toBeUndefined()
  })

  test('diary.delete-entry: remove one entry', async () => {
    recorder.expect({
      id: 'diary.delete-entry',
      description: 'Delete an entry',
      consumer: 'src/features/diary/useDiary.ts useDeleteDiaryEntry()',
      providerStates: [SIGNED_IN, { name: 'a diary entry exists', params: { id: ENTRY_1, date: DATE } }],
      request: {
        method: 'DELETE',
        path: '/rest/v1/diary_entries',
        query: { id: `eq.${ENTRY_1}` },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: { status: 204, headers: {}, schema: null, body: null },
    })

    await expect(mutate('deleteEntry', ENTRY_1)).resolves.toBeUndefined()
  })

  test('diary.delete-entries: remove a multi-selection', async () => {
    recorder.expect({
      id: 'diary.delete-entries',
      description: 'Delete several entries at once',
      consumer: 'src/features/diary/useDiary.ts useDeleteDiaryEntries()',
      providerStates: [SIGNED_IN],
      request: {
        method: 'DELETE',
        path: '/rest/v1/diary_entries',
        query: { id: `in.(${ENTRY_1},${ENTRY_2})` },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: { status: 204, headers: {}, schema: null, body: null },
    })

    await expect(mutate('deleteEntries', [ENTRY_1, ENTRY_2])).resolves.toBeUndefined()
  })
})

// -- the daily summary -------------------------------------------------------------
// There is no summary endpoint: DiaryPage sums the day's entries, adds the
// day's cardio calories and compares with the goal resolved from the profile.
// Its contract is therefore these three reads (plus diary.read-day above).

describe('daily summary', () => {
  test("summary.read-cardio-day: the day's burned calories", async () => {
    recorder.expect({
      id: 'summary.read-cardio-day',
      description: "Read one day's cardio entries",
      consumer: 'src/features/exercise/useExercise.ts useExerciseEntries() -> fetchExerciseEntries(); DiaryPage sums .calories',
      providerStates: [SIGNED_IN, { name: 'an exercise entry exists', params: { date: DATE } }],
      request: {
        method: 'GET',
        path: '/rest/v1/exercise_entries',
        query: { select: '*', entry_date: `eq.${DATE}`, order: 'created_at.asc' },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: { status: 200, headers: JSON_RESPONSE, schema: t.array(CARDIO_ROW), body: [CARDIO] },
    })

    expect(await fetchExerciseEntries(DATE)).toEqual([CARDIO])
  })

  test('summary.read-profile: the goal, macro targets and settings', async () => {
    recorder.expect({
      id: 'summary.read-profile',
      description: "Read the signed-in user's profile",
      consumer: 'src/features/profile/useProfile.ts useProfile() -> fetchProfile(); DiaryPage resolves the calorie goal from it',
      providerStates: [SIGNED_IN, { name: 'the user has a profile' }],
      request: {
        method: 'GET',
        path: '/rest/v1/profiles',
        query: { select: '*' },
        headers: AUTH_HEADERS,
        body: null,
      },
      response: { status: 200, headers: JSON_RESPONSE, schema: t.array(PROFILE_ROW), body: [PROFILE] },
    })

    expect(await fetchProfile()).toEqual(PROFILE)
  })

  test('profile.update: save a setting and get the stored row back', async () => {
    const stored = { ...PROFILE, eat_back_exercise: true, updated_at: '2026-10-21T12:00:00+00:00' }
    recorder.expect(currentUser())
    recorder.expect({
      id: 'profile.update',
      description: 'Save profile fields',
      consumer: 'src/features/profile/useProfile.ts useUpdateProfile() -> updateProfile()',
      providerStates: [SIGNED_IN, { name: 'the user has a profile' }],
      request: {
        method: 'PATCH',
        path: '/rest/v1/profiles',
        query: { id: `eq.${USER_ID}`, select: '*' },
        headers: {
          ...AUTH_HEADERS,
          ...JSON_BODY,
          prefer: 'return=representation',
          accept: 'application/vnd.pgrst.object+json',
        },
        body: t.partial(PROFILE_PROPS),
      },
      // A single-object read comes back as PostgREST's object media type.
      response: {
        status: 200,
        headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        schema: PROFILE_ROW,
        body: stored,
      },
    })

    expect(await updateProfile({ eat_back_exercise: true })).toEqual(stored)
  })
})

// -- the contract file -------------------------------------------------------------

const ALL = [
  'auth.sign-in-wrong-password',
  'auth.sign-in',
  'auth.current-user',
  'diary.log-food',
  'diary.log-food-already-saved',
  'diary.confirm-entries-saved',
  'diary.read-day',
  'diary.update-servings',
  'diary.update-entry',
  'diary.delete-entry',
  'diary.delete-entries',
  'summary.read-cardio-day',
  'summary.read-profile',
  'profile.update',
]

test('contracts/fitlog-web--supabase.json is up to date', async () => {
  expect(
    recorder.interactions.map((i) => i.id),
    'fix the failing consumer tests above first; the file is only written from a full set',
  ).toEqual(ALL)
  // Out of date = the app's needs changed. Review the diff, then regenerate
  // with `npm run contracts:update` and verify the providers still satisfy it.
  await expect(
    contractJson(recorder.contract('contracts/consumer/supabase.consumer.test.ts')),
  ).toMatchFileSnapshot('../fitlog-web--supabase.json')
})
