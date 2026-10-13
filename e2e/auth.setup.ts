import { test as setup, expect } from './fixtures'
import { authFile, SESSION_USERS, USERS } from './support/env'

// Signs in once through the real login form and saves the session (Supabase
// keeps it in localStorage) so every other spec starts authenticated. Alice is
// the default (playwright.config.ts); specs for per-user areas switch with
// test.use({ storageState: authFile('carol') }).
for (const user of SESSION_USERS) {
  setup(`sign in as ${user}`, async ({ page, loginPage, diaryPage }) => {
    await loginPage.goto()
    await loginPage.signIn(USERS[user].email, USERS[user].password)
    await diaryPage.expectLoaded()
    await expect(diaryPage.navTab('Diary')).toBeVisible()

    await page.context().storageState({ path: authFile(user) })
  })
}
