import { defineConfig, devices } from '@playwright/test'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './e2e/support/env'

// E2E runs the Vite dev server against the LOCAL Supabase stack only
// (`npm run db:start`); e2e/support/env.ts refuses any non-local URL. The
// VITE_* values are passed to the server explicitly, and they take priority
// over a developer's .env, so a hosted project is never used by accident.
// Port 5174 + no server reuse keeps it separate from a normal `npm run dev`.
const PORT = 5174
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Two retries in CI so an intermittent failure doesn't block a release, but a
  // test that needed one is reported as "flaky" (not "passed") and tracked on
  // the quality dashboard (metrics/), so retries surface flakiness, not hide it.
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'reports/playwright.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // Database-level RLS checks: no browser, just the Supabase API.
    { name: 'api', testMatch: /rls\.spec\.ts/ },
    {
      // FitLog is phone-first, so the UI journeys run in Chromium as a phone.
      name: 'mobile-chromium',
      testMatch: /tests\/.*\.spec\.ts/,
      testIgnore: /rls\.spec\.ts/,
      use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/alice.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
      VITE_USDA_API_KEY: '',
    },
  },
})
