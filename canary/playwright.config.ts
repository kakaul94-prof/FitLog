import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { target } from './env'

// The production app canary: one Pixel-7-sized Chromium, one journey, against
// the LIVE site as the monitor account (canary/README.md). Separate from
// playwright.config.ts on purpose: the E2E suite refuses any hosted Supabase
// project (e2e/support/env.ts) and this must point at exactly one.
//
// Reading the target here means a missing secret fails `playwright test`
// before a browser starts, with the variable's name in the output.
const t = target()

const out = (p: string) => fileURLToPath(new URL(`../reports/app-canary/${p}`, import.meta.url))

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  // One retry: a single dropped connection should not open an alert, but a
  // run that needed the retry is recorded as "flaky", never as a clean pass.
  retries: 1,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  outputDir: out('test-results'),
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: out('playwright.json') }],
    ['html', { open: 'never', outputFolder: out('html') }],
  ],
  use: {
    ...devices['Pixel 7'],
    baseURL: t.siteUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
