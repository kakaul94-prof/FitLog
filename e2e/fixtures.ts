import { test as base } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CardioPage } from './pages/CardioPage'
import { DiaryPage } from './pages/DiaryPage'
import { FoodPickerPage } from './pages/FoodPickerPage'
import { LoginPage } from './pages/LoginPage'
import { ProgramPage } from './pages/ProgramPage'
import { ProgressPage } from './pages/ProgressPage'
import { RecipePage } from './pages/RecipePage'
import { RoutinePage } from './pages/RoutinePage'
import { TrackPage } from './pages/TrackPage'
import { WorkoutPage } from './pages/WorkoutPage'
import { signedInClient } from './support/api'
import { USERS } from './support/env'
import { FakeGps } from './support/gps'
import { UsdaStub } from './support/usda'

type Fixtures = {
  loginPage: LoginPage
  diaryPage: DiaryPage
  foodPickerPage: FoodPickerPage
  workoutPage: WorkoutPage
  progressPage: ProgressPage
  recipePage: RecipePage
  routinePage: RoutinePage
  programPage: ProgramPage
  cardioPage: CardioPage
  trackPage: TrackPage
  /** Supabase client signed in as Alice (the browser's account) for DB assertions. */
  aliceDb: SupabaseClient
  /** Carol owns the program spec's data, Dave the routines spec's, Erin cardio + GPS (support/env.ts). */
  carolDb: SupabaseClient
  daveDb: SupabaseClient
  erinDb: SupabaseClient
  /** Test-driven GPS + fake clock; installed before the page loads. */
  gps: FakeGps
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
  recipePage: async ({ page }, use) => use(new RecipePage(page)),
  routinePage: async ({ page }, use) => use(new RoutinePage(page)),
  programPage: async ({ page }, use) => use(new ProgramPage(page)),
  cardioPage: async ({ page }, use) => use(new CardioPage(page)),
  trackPage: async ({ page }, use) => use(new TrackPage(page)),
  aliceDb: async ({}, use) => use(await signedInClient(USERS.alice)),
  carolDb: async ({}, use) => use(await signedInClient(USERS.carol)),
  daveDb: async ({}, use) => use(await signedInClient(USERS.dave)),
  erinDb: async ({}, use) => use(await signedInClient(USERS.erin)),
  gps: async ({ page }, use) => {
    const gps = new FakeGps(page)
    await gps.install()
    await use(gps)
  },
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
