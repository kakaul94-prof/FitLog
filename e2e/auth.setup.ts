import { test as setup, expect } from './fixtures'
import { USERS } from './support/env'

// Signs in once through the real login form and saves the session (Supabase
// keeps it in localStorage) so every other spec starts authenticated.
export const AUTH_FILE = 'e2e/.auth/alice.json'

setup('sign in as Alice', async ({ page, loginPage, diaryPage }) => {
  await loginPage.goto()
  await loginPage.signIn(USERS.alice.email, USERS.alice.password)
  await diaryPage.expectLoaded()
  await expect(diaryPage.navTab('Diary')).toBeVisible()

  await page.context().storageState({ path: AUTH_FILE })
})
