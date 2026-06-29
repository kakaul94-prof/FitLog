import { test as setup, expect } from '@playwright/test'

// Signs in once with the tester account and saves the session (Supabase keeps it
// in localStorage) so the other specs start authenticated. Override the account
// with E2E_EMAIL / E2E_PASSWORD; defaults are the documented dev tester.
const authFile = 'e2e/.auth/user.json'
const EMAIL = process.env.E2E_EMAIL ?? 'tester@fitlog.app'
const PASSWORD = process.env.E2E_PASSWORD ?? 'FitLogTester1!'

setup('authenticate', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // On success onAuthStateChange swaps in the signed-in shell (bottom nav).
  await expect(
    page.getByRole('link', { name: 'Diary', exact: true }),
  ).toBeVisible({ timeout: 15_000 })

  await page.context().storageState({ path: authFile })
})
