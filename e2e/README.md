# E2E tests (Playwright)

Smoke-level browser tests for the critical paths. Kept deliberately small — UI is
mainly verified on the deployed app; these guard that the app boots, auth works,
and a real write reaches the backend.

## How it works

- Playwright boots the **dev server** (`npm run dev`, port 5173) as its
  `webServer`. The dev build is required because `src/lib/supabase.ts` only
  exposes `window.__supabase` under `import.meta.env.DEV`, which the specs use to
  confirm writes and clean up after themselves.
- `auth.setup.ts` signs in once and saves the session to `e2e/.auth/user.json`;
  the other specs reuse it.

## Prerequisites (one-time)

1. **Point the dev build at the DEV Supabase project**, not prod — these specs
   write real rows under the tester account. Set `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` in `.env` to the dev project.
2. The tester account must exist in that project. Defaults:
   `tester@fitlog.app` / `FitLogTester1!` (override with `E2E_EMAIL` /
   `E2E_PASSWORD`).
3. Install the browser (Chromium only). To avoid filling `C:`, cache it on `D:`:
   ```sh
   # PowerShell, from the repo root
   $env:PLAYWRIGHT_BROWSERS_PATH = "D:\playwright-browsers"
   npx playwright install chromium
   ```
   Set the same `PLAYWRIGHT_BROWSERS_PATH` whenever you run the suite.
4. If NordVPN Threat Protection is on, allowlist `*.supabase.co` or sign-in will
   fail with "Failed to fetch".

## Run

```sh
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI mode (watch/debug)
npx playwright test --list   # validate config + specs without running
```

## Deferred flows (next)

These are multi-page and were left as follow-ups (write them once you can run the
suite locally to confirm selectors):

- **Log a food** to the diary (`/` → add → food picker → save).
- **Log a strength set** (`/strength` → start/open a workout → add set).

Pattern to follow: drive the UI, assert via `window.__supabase`, then delete the
rows you created (see `measurement.spec.ts`).
