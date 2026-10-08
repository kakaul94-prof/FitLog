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
| `tests/recipes.spec.ts` | Build a recipe (per-serving nutrients stored), recalculation on yield / ingredient changes, log recipe servings to the diary |
| `tests/routines.spec.ts` | Create a template with targets, start a workout from it, leaving with unsaved edits (Discard vs Save) — as Dave |
| `tests/program.spec.ts` | Pick a preset program, Next up follows the rotation (skips rest, wraps), "Set as next" persists without dropping other program data, switching programs and back restores the rotation — as Carol, run in order |
| `tests/cardio.spec.ts` | Log cardio with hand-checked calorie estimates (by time and by distance), override calories, edit then delete, custom activity, exercise raises the day's calorie budget (as Erin, one date per test) |
| `tests/gps.spec.ts` | GPS walk end to end (fake GPS + fake clock), noise / teleport / jitter filtering, pause excludes time and movement, denied location permission (as Erin) |
| `tests/entries.spec.ts` | Edit servings and meal, delete (with confirm), unsaved-changes prompt (Keep editing / Discard / Save), press-and-hold Delete and Move, multi-select delete, the picker's just-added tray, weigh-in date change and delete (as Heidi) |
| `tests/trainer.spec.ts` | Ask-a-trainer with a stubbed `/api/trainer`: reply shown, request grounded in a snapshot of the user's log, follow-ups send the conversation, starter prompts, remember offer + memory page, error recovery, Stop, in-workout chat (as Frank, in order) |
| `tests/backup.spec.ts` | Export (all 17 tables, only your rows) and restore: round trip, preview + Cancel, links kept (recipe → ingredients, workout → sets), foreign `user_id`s forced to your own, replace-not-merge, invalid files rejected (as Grace, in order) |
| `tests/food-search.spec.ts` | Library search (partial match, empty state, add with servings, never another user's foods), multi-add, Recent tab, nutrient snapshot survives a food edit, USDA import / no matches / outage (stubbed) |
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
- **Test data.** `supabase/seed.sql` creates Alice (the default browser user),
  Bob (owns private rows for the RLS spec), and one account per area with
  per-user state: Carol (program: one record per user) Dave (templates,
  which change what the Exercise tab offers) Erin (cardio + GPS, with a
  fixed 80 kg weigh-in so calorie estimates are known numbers), Frank (trainer
  memory), Grace (backup: a restore wipes the account) and Heidi (entry edits
  and weigh-ins). Parallel specs can't change each
  other's state, and the program spec runs its tests in order because they
  share Carol's record. Names are made unique per run, so the
  suite can rerun without a reset. `npm run db:reset` restores the seed.
  Specs set up their own rows through the API (`support/data.ts`) and do the
  journey under test through the UI.
- **External APIs are stubbed.** The app gets a dummy USDA key so its USDA UI
  shows, and the `usda` fixture (`support/usda.ts`) answers every request to
  `api.nal.usda.gov` with canned data or a chosen error. The real API is never
  called, and an unstubbed USDA request fails the test. The trainer's `/api/trainer`
  (a Cloudflare function that streams Claude) is stubbed the same way
  (`support/trainer.ts`): replies are scripted and each request is recorded,
  so tests check what the app *sends* (conversation, data snapshot, memory)
  without calling a real model.
- **Fake GPS + fake clock.** `support/gps.ts` swaps `navigator.geolocation`
  for one the test drives and installs Playwright's clock, so a 6-minute walk
  with chosen noise runs in about a second and distances are exact.
- **Syncing on optimistic UI.** The food picker shows "Added …" before the
  insert lands, so the page object waits for the insert's network response,
  not the toast.
- **Safety.** `support/env.ts` throws if the Supabase URL isn't local, and the
  config passes the local URL/key to Vite explicitly (overriding any `.env`)
  on its own port (5174) with no server reuse.

## Gotcha worth knowing

Workout set inputs save on blur, and "Mark as done" discards a workout whose
sets haven't saved yet. `WorkoutPage.logSet()` waits for the e1RM badge (which
renders from the saved set) before moving on, or the fast automated tap wins
the race and the workout is deleted.
