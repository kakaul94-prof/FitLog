import { test as base } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DiaryPage } from './pages/DiaryPage'
import { FoodPickerPage } from './pages/FoodPickerPage'
import { LoginPage } from './pages/LoginPage'
import { ProgressPage } from './pages/ProgressPage'
import { WorkoutPage } from './pages/WorkoutPage'
import { signedInClient } from './support/api'
import { USERS } from './support/env'
import { UsdaStub } from './support/usda'

type Fixtures = {
  loginPage: LoginPage
  diaryPage: DiaryPage
  foodPickerPage: FoodPickerPage
  workoutPage: WorkoutPage
  progressPage: ProgressPage
  /** Supabase client signed in as Alice (the browser's account) for DB assertions. */
  aliceDb: SupabaseClient
  /** Fake USDA API for this test's page; fails the test on any USDA call it didn't stub. */
  usda: UsdaStub
}

/** `test` with page objects and a DB client injected, so specs never `new` anything. */
export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  diaryPage: async ({ page }, use) => use(new DiaryPage(page)),
  foodPickerPage: async ({ page }, use) => use(new FoodPickerPage(page)),
  workoutPage: async ({ page }, use) => use(new WorkoutPage(page)),
  progressPage: async ({ page }, use) => use(new ProgressPage(page)),
  aliceDb: async ({}, use) => use(await signedInClient(USERS.alice)),
  usda: async ({ page }, use) => {
    const usda = new UsdaStub(page)
    await usda.install()
    await use(usda)
    usda.expectNoUnexpectedCalls()
  },
})

export { expect } from '@playwright/test'

/** A value unique to this test run, so reruns against the same DB never collide. */
export const runId = () => Date.now().toString(36)
