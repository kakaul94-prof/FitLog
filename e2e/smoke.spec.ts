import { test, expect } from '@playwright/test'

// Reuses the auth state from auth.setup.ts (wired up in playwright.config.ts).
test.describe('app shell', () => {
  test('shows the four bottom-nav tabs when signed in', async ({ page }) => {
    await page.goto('/')
    for (const label of ['Diary', 'Exercise', 'Progress', 'More']) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
      ).toBeVisible()
    }
  })

  test('navigates to Progress', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Progress', exact: true }).click()
    await expect(page).toHaveURL(/\/progress$/)
  })
})
