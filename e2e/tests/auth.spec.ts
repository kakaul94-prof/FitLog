import { test, expect } from '../fixtures'
import { USERS } from '../support/env'

// Start signed out, overriding the project's saved Alice session.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('sign in', () => {
  test('rejects a wrong password with an inline error', async ({ loginPage, diaryPage }) => {
    await loginPage.goto()
    await loginPage.signIn(USERS.alice.email, 'not-the-password')

    await expect(loginPage.errorMessage).toBeVisible()
    await expect(diaryPage.heading).toBeHidden()
  })

  test('signs in and lands on the diary with the bottom nav', async ({
    loginPage,
    diaryPage,
  }) => {
    await loginPage.goto()
    await loginPage.signIn(USERS.alice.email, USERS.alice.password)

    await diaryPage.expectLoaded()
    for (const tab of ['Diary', 'Exercise', 'Progress', 'More'] as const) {
      await expect(diaryPage.navTab(tab)).toBeVisible()
    }
  })
})
