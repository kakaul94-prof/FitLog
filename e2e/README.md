# E2E tests (Playwright)

Browser tests for FitLog's critical user journeys, plus database-level checks
of Row-Level Security. They run against a disposable **local** Supabase stack,
never a hosted project.

| Spec | Journey |
|---|---|
| `tests/auth.spec.ts` | Wrong password shows an error; valid sign-in lands on the diary |
| `tests/diary.spec.ts` | Log a meal with Quick add; row saved with the right meal + calories |
| `tests/workout.spec.ts` | Start a workout, add an exercise, log a set, mark done; set saved |
| `tests/progress.spec.ts` | Log body weight; appears in history and in the DB |
| `tests/rls.spec.ts` | Alice can't read, forge, update or delete Bob's rows; anon sees nothing |

## Run it

```bash
npm run test:e2e:docker        # everything in Docker (the CI path)

# or on the host, for the debugging UI / headed browsers:
npm run db:start
npx playwright install chromium
npm run test:e2e               # or: npm run test:e2e:ui
```

Report: `npx playwright show-report`.

## How it's built

- **Page Object Model.** `pages/` holds one class per screen (locators +
  actions); specs get them from `fixtures.ts`, so selectors live in one place.
- **Projects** (`playwright.config.ts`): `setup` signs in through the real form
  once and saves the session; `mobile-chromium` runs the UI journeys as a
  Pixel 7 with that session; `api` runs the RLS spec with no browser.
- **DB assertions.** Specs check the UI *and* poll Postgres via a Supabase
  client signed in as the same user, so a test fails if the UI looks right but
  nothing was saved.
- **Test data.** `supabase/seed.sql` creates Alice (the browser user) and Bob
  (owns private rows for the RLS spec). Names are made unique per run, so the
  suite can rerun without a reset. `npm run db:reset` restores the seed.
- **Safety.** `support/env.ts` throws if the Supabase URL isn't local, and the
  config passes the local URL/key to Vite explicitly (overriding any `.env`)
  on its own port (5174) with no server reuse.

## Gotcha worth knowing

Workout set inputs save on blur, and "Mark as done" discards a workout whose
sets haven't saved yet. `WorkoutPage.logSet()` waits for the e1RM badge (which
renders from the saved set) before moving on, or the fast automated tap wins
the race and the workout is deleted.
