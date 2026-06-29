/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test'

// A full write path: log a body-weight measurement through the UI, confirm it
// persisted, then delete it via the dev-only window.__supabase so the tester
// account stays clean. Uses a sentinel value unlikely to collide with demo data.
test('logs a body-weight measurement and cleans it up', async ({ page }) => {
  const value = 188.81

  await page.goto('/progress')

  // The weight card's only number input + its "Add" button.
  await page.getByRole('spinbutton').first().fill(String(value))
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // Confirm it reached the backend (dev client exposed on window).
  await expect
    .poll(
      () =>
        page.evaluate(async (v) => {
          const sb = (window as unknown as { __supabase: any }).__supabase
          const { data } = await sb
            .from('measurements')
            .select('id')
            .eq('type', 'weight')
            .eq('value', v)
          return data?.length ?? 0
        }, value),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)

  // Cleanup so re-runs stay idempotent.
  await page.evaluate(async (v) => {
    const sb = (window as unknown as { __supabase: any }).__supabase
    await sb.from('measurements').delete().eq('type', 'weight').eq('value', v)
  }, value)
})
