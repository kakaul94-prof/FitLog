import { defineConfig, devices } from '@playwright/test'

// E2E runs against the DEV server on purpose: src/lib/supabase.ts only exposes
// `window.__supabase` under import.meta.env.DEV, and the specs use it to confirm
// writes and clean up. The dev build MUST point at the DEV Supabase project —
// never prod — because these specs write real rows under the tester account.
const PORT = 5173
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // One tester account + a shared backend: keep everything serialized.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
    viewport: { width: 414, height: 896 }, // phone-first layout
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
