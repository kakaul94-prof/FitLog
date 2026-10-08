import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '../fixtures'
import { anonClient } from '../support/api'
import { addWeighIn, createFood, dayFromToday, logFood, todayISO } from '../support/data'
import { authFile, USERS } from '../support/env'

// Profile and goals, as Ivan. The profile is one record per user, so these
// tests run one at a time, each from the same baseline: a manual 2,000
// cal/day goal, no details, no history, no weigh-ins or food.
test.use({ storageState: authFile('ivan') })
test.describe.configure({ mode: 'default' })

const ivan = USERS.ivan

async function resetIvan(db: SupabaseClient): Promise<void> {
  const { error } = await db
    .from('profiles')
    .update({
      sex: null,
      birth_date: null,
      height_cm: null,
      activity_level: 'moderate',
      goal_rate_lb_per_week: 0,
      goal_weight_lb: null,
      calorie_goal_mode: 'manual',
      manual_calorie_goal: 2000,
      calorie_goal_history: [],
      macro_targets: null,
    })
    .eq('id', ivan.id)
  if (error) throw new Error(`resetIvan: ${error.message}`)
  await db.from('diary_entries').delete().not('id', 'is', null)
  await db.from('measurements').delete().not('id', 'is', null)
}

test.beforeEach(async ({ ivanDb }) => {
  await resetIvan(ivanDb)
})

test('a manual calorie target drives the diary', async ({ profilePage: profile, diaryPage: diary }) => {
  await profile.open()
  await profile.manualTargetInput.fill('1800')
  await profile.save()

  await diary.gotoDate(todayISO())
  await expect(diary.remaining(1800)).toBeVisible()
})

test('a calculated goal matches Mifflin-St Jeor × activity − the weekly deficit', async ({
  ivanDb,
  profilePage: profile,
  diaryPage: diary,
  page,
}) => {
  await profile.open()
  await profile.manualToggle.uncheck()
  await profile.sexSelect.selectOption('male')
  await profile.birthDateInput.fill(`${new Date().getFullYear() - 30}-01-01`) // 30 years old
  await profile.heightFeetInput.fill('5')
  await profile.heightInchesInput.fill('10') // 177.8 cm
  await profile.activitySelect.selectOption('moderate') // × 1.55
  await profile.weightInput.fill('180') // 81.65 kg
  await profile.weeklyGoalSelect.selectOption('-1') // −500 cal/day

  // BMR = 10 × 81.65 + 6.25 × 177.8 − 5 × 30 + 5 = 1,782.7
  // goal = 1,782.7 × 1.55 − 3,500 ÷ 7 = 2,263
  await expect(page.getByText('2263 calories', { exact: true })).toBeVisible()
  await profile.save()

  await diary.gotoDate(todayISO())
  await expect(diary.remaining(2263)).toBeVisible()
  const { data } = await ivanDb.from('profiles').select('calorie_goal_mode, sex, height_cm').eq('id', ivan.id).single()
  expect(data).toMatchObject({ calorie_goal_mode: 'calculated', sex: 'male' })
})

test('changing the goal is not retroactive: past days keep the goal they had', async ({ profilePage: profile, diaryPage: diary }) => {
  await profile.open()
  await profile.manualTargetInput.fill('1800')
  await profile.save()

  await diary.gotoDate(todayISO())
  await expect(diary.remaining(1800)).toBeVisible()
  await diary.gotoDate('2025-06-01')
  await expect(diary.remaining(2000)).toBeVisible()
})

test('macros: grams, % of calories and the remainder resolve to the right grams', async ({ ivanDb, profilePage: profile, page }) => {
  await profile.open()
  await profile.macroType('Protein').selectOption('g')
  await profile.macroAmount('Protein').fill('150')
  await profile.macroType('Fat').selectOption('pct')
  await profile.macroAmount('Fat').fill('25')
  await profile.macroType('Carbs').selectOption('remainder')

  // On 2,000 cal: protein 150 g = 600 cal; fat 25% = 500 cal = 56 g;
  // carbs get the rest: (2,000 − 600 − 500) ÷ 4 = 225 g.
  await expect(profile.macroTarget('150 g · 30%')).toBeVisible()
  await expect(profile.macroTarget('56 g · 25%')).toBeVisible()
  await expect(profile.macroTarget('225 g · 45%')).toBeVisible()
  await profile.save()

  await page.reload()
  await expect(profile.macroTarget('225 g · 45%')).toBeVisible()
  const { data } = await ivanDb.from('profiles').select('macro_targets').eq('id', ivan.id).single()
  expect(data?.macro_targets).toMatchObject({
    protein: { mode: 'g', value: 150 },
    fat: { mode: 'pct', value: 25 },
    carb: { mode: 'remainder' },
  })
})

test('protein in g per lb follows bodyweight', async ({ profilePage: profile }) => {
  await profile.open()
  await profile.weightInput.fill('180')
  await profile.macroType('Protein').selectOption('g_per_lb')
  await profile.macroAmount('Protein').fill('1')
  await expect(profile.macroTarget('180 g · 36%')).toBeVisible() // 180 × 4 ÷ 2,000

  await profile.weightInput.fill('200')
  await expect(profile.macroTarget('200 g · 40%')).toBeVisible()
})

test('Save confirms, and the values survive a reload', async ({ profilePage: profile, page }) => {
  await profile.open()
  await profile.goalWeightInput.fill('170')
  await profile.activitySelect.selectOption('active')
  await profile.save()

  await page.reload()
  await expect(profile.goalWeightInput).toHaveValue('170')
  await expect(profile.activitySelect).toHaveValue('active')
})

test('"From your data" sets the goal the app measured from intake and weight change', async ({
  ivanDb,
  profilePage: profile,
  diaryPage: diary,
}) => {
  // Three weeks of 2,200 cal days while weight went 181 → 179 lb.
  const meal = await createFood(ivanDb, 'E2E Daily intake', 2200)
  for (let d = 21; d >= 1; d--) await logFood(ivanDb, meal, { date: dayFromToday(-d) })
  await addWeighIn(ivanDb, dayFromToday(-20), 181)
  await addWeighIn(ivanDb, dayFromToday(-1), 179)

  await profile.open()
  const label = (await profile.adaptiveButton.textContent())!
  const goal = Number(label.replace(/\D/g, ''))
  await profile.adaptiveButton.click()

  await expect(profile.manualTargetInput).toHaveValue(String(goal))
  await diary.gotoDate(todayISO())
  await expect(diary.remaining(goal)).toBeVisible()
})

test('a calculated goal needs your details first', async ({ profilePage: profile, page }) => {
  await profile.open()
  await profile.manualToggle.uncheck()

  await expect(page.getByText('Add sex, birth date, height, current weight to calculate your goal.')).toBeVisible()
})

test('changing the password: a mismatch is refused, a match works', async ({ profilePage: profile, page }) => {
  const newPassword = 'ivan-new-password'
  try {
    await profile.open()
    await profile.newPasswordInput.fill(newPassword)
    await profile.confirmPasswordInput.fill('something-else')
    await profile.updatePasswordButton.click()
    await expect(page.getByText('Passwords do not match.')).toBeVisible()

    await profile.confirmPasswordInput.fill(newPassword)
    await profile.updatePasswordButton.click()
    await expect(page.getByRole('button', { name: 'Password updated ✓' })).toBeVisible()

    const { error } = await anonClient().auth.signInWithPassword({ email: ivan.email, password: newPassword })
    expect(error).toBeNull()
  } finally {
    // Put the seed password back so the next run's sign-in works.
    const client = anonClient()
    const { error } = await client.auth.signInWithPassword({ email: ivan.email, password: newPassword })
    if (!error) await client.auth.updateUser({ password: ivan.password })
  }
})

// Last on purpose: the app signs out of every session on the account, so this
// test signs in fresh rather than reusing the saved session the others share.
test.describe('signing out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('returns to sign-in, and app pages ask you to sign in again', async ({ loginPage, diaryPage: diary, page }) => {
    await loginPage.goto()
    await loginPage.signIn(ivan.email, ivan.password)
    await diary.expectLoaded()

    await page.goto('/more')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(loginPage.signInButton).toBeVisible()

    await page.goto('/strength')
    await expect(loginPage.signInButton).toBeVisible()
  })
})
