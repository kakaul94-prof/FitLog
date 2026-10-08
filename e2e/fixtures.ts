import { test as base } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BackupPage } from './pages/BackupPage'
import { CardioPage } from './pages/CardioPage'
import { DiaryPage } from './pages/DiaryPage'
import { EntryPage } from './pages/EntryPage'
import { FoodPickerPage } from './pages/FoodPickerPage'
import { LoginPage } from './pages/LoginPage'
import { ProgramPage } from './pages/ProgramPage'
import { ProgressPage } from './pages/ProgressPage'
import { RecipePage } from './pages/RecipePage'
import { RoutinePage } from './pages/RoutinePage'
import { TrackPage } from './pages/TrackPage'
import { TrainerPage } from './pages/TrainerPage'
import { WorkoutPage } from './pages/WorkoutPage'
import { signedInClient } from './support/api'
import { USERS } from './support/env'
import { FakeGps } from './support/gps'
import { TrainerStub } from './support/trainer'
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
  entryPage: EntryPage
  trainerPage: TrainerPage
  backupPage: BackupPage
  /** Supabase client signed in as Alice (the browser's account) for DB assertions. */
  aliceDb: SupabaseClient
  /** One account per area with per-user state (support/env.ts): Carol program, Dave routines, Erin cardio + GPS, Frank trainer, Grace backup, Heidi entries. */
  carolDb: SupabaseClient
  daveDb: SupabaseClient
  erinDb: SupabaseClient
  frankDb: SupabaseClient
  graceDb: SupabaseClient
  heidiDb: SupabaseClient
  /** Scripted /api/trainer; records what the app sent. */
  trainer: TrainerStub
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
  entryPage: async ({ page }, use) => use(new EntryPage(page)),
  trainerPage: async ({ page }, use) => use(new TrainerPage(page)),
  backupPage: async ({ page }, use) => use(new BackupPage(page)),
  aliceDb: async ({}, use) => use(await signedInClient(USERS.alice)),
  carolDb: async ({}, use) => use(await signedInClient(USERS.carol)),
  daveDb: async ({}, use) => use(await signedInClient(USERS.dave)),
  erinDb: async ({}, use) => use(await signedInClient(USERS.erin)),
  frankDb: async ({}, use) => use(await signedInClient(USERS.frank)),
  graceDb: async ({}, use) => use(await signedInClient(USERS.grace)),
  heidiDb: async ({}, use) => use(await signedInClient(USERS.heidi)),
  trainer: async ({ page }, use) => {
    const trainer = new TrainerStub(page)
    await trainer.install()
    await use(trainer)
    await trainer.dispose()
  },
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
