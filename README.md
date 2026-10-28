# FitLog

A phone-first Progressive Web App for tracking nutrition, cardio, strength, and body weight — a personal, modern take on the classic MyFitnessPal, built end-to-end with React 19, TypeScript, and Supabase.

**How it is tested:** [TEST-STRATEGY.md](TEST-STRATEGY.md), the test strategy in brief: risks, layers, release gates and known gaps.

**Live app:** [fitlog-9wl.pages.dev](https://fitlog-9wl.pages.dev)

<!-- Add a screenshot or two here — a phone-sized capture of the Diary and Progress views goes a long way. -->

## Overview

FitLog is a single-user, cloud-synced fitness tracker designed mobile-first and installable as a PWA. It covers the full daily loop: logging food against calorie and macro goals, importing whole-food nutrition data from the USDA database, tracking cardio and strength workouts, and charting body-weight and lifting progress over time. The entire stack — data model, business logic, UI, tests, and CI/CD — was designed and built from scratch.

## Features

- **Food diary** with calorie, macro, and full micronutrient tracking (31 nutrients with %DV), plus a live logging streak.
- **USDA food import** — search and import whole-food nutrition data, with automatic per-serving rescaling from the source's per-100g values.
- **Recipes** — build multi-ingredient recipes whose per-serving nutrition is computed and stored automatically.
- **Cardio tracking** — MET-based or distance-based calorie estimates (walk/run/hike) with a manual override, and optional "eat-back" of burned calories.
- **Strength training** — workouts, exercises, and sets with supersets, estimated 1RM (Epley), and per-exercise progression charts (max weight, total volume, average weight per session).
- **Body measurements** — weight plus optional body metrics, with moving-average trend charts.
- **Smart calorie goals** — a hybrid Mifflin-St Jeor BMR × activity model with a deficit derived from a target weekly rate, or a manual override.
- **Installable PWA** with offline read access to recent data.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| Styling | Tailwind CSS v4, small `cva`-based UI primitives (shadcn-style, no CLI) |
| Routing & data | React Router (lazy routes), TanStack Query |
| Backend | Supabase — Postgres + Auth (email/password, magic-link fallback) |
| Charts | Hand-rolled SVG (line charts + macro donut) — no charting library |
| Icons / PWA | lucide-react, vite-plugin-pwa |
| Testing | Vitest (unit), pytest + pytest-bdd + httpx + psycopg (API / database / security), Playwright (E2E, Page Object Model), Allure, Docker + Docker Compose |
| Hosting / CI | Cloudflare Pages, GitHub Actions (tests gate every production deploy) |

## Architecture Highlights

- **Row-Level Security everywhere.** Every table is RLS owner-only, with `user_id` defaulting to `auth.uid()` — access control is enforced in the database, not just the client. Links between tables include the owner too (`(food_id, user_id) → foods(id, user_id)`), so one user's rows can never point at another's.
- **Snapshotting for historical accuracy.** Diary entries snapshot a food's nutrition at log time, so editing a food later never rewrites past days.
- **Feature-based data layer.** TanStack Query hooks are organized per feature with a consistent query-key scheme, and mutations invalidate exactly the keys they affect.
- **Pure, testable core logic.** Calorie/macro math, 1RM, MET calories, BMI, and progression live in dependency-free `src/lib` modules, unit-tested in isolation.
- **Hand-rolled SVG charts** keep the bundle lean and give full control over the mobile-first visualizations.

## Testing

Four layers, each where it is cheapest to prove what it proves:

| Layer | Tool | Size | What it proves |
|---|---|--:|---|
| Unit | [Vitest](https://vitest.dev) | 685 tests, ~10 s | The pure logic: calorie goals, macros, 1RM, progression, dates, nutrients; the canary's summariser, alerts and history; the Sentry scrubber |
| API, database and security | pytest + pytest-bdd ([`api-tests/`](api-tests/README.md)) | 646 tests, ~1 min | Every table is private to its owner (through the API and in Postgres itself), forged tokens are refused everywhere, responses match strict contracts, bad input is refused cleanly, nothing leaks, and the AI functions send and handle exactly what they should |
| Contracts (frontend ↔ API) | Vitest ([`contracts/`](#contract-tests)) | 24 interactions, 61 checks, ~10 s + the local stack | The requests the app really sends and the fields it really reads, recorded from the app's own code and replayed against the Pages Functions in-process and against PostgREST + Auth live: a renamed field, a changed type or a removed endpoint the frontend depends on fails by name |
| AI trainer evals | pytest ([`ai-evals/`](ai-evals/README.md)) | 264 tests, ~2 min; live tier on demand; production canary twice a day | The Ask-a-trainer chat's guardrails against prompt injection, information exposure, unintended actions and a failing Claude, with Claude replaced by a stub (every push); the real model's behaviour on 87 cases x 3 runs, including fairness (counterfactual name, age and sex pairs scored for equivalence, and stated dietary and religious constraints), judged where rules can't decide (by hand, capped at a few dollars); and a canary of ten cases through the deployed production trainer twice a day, with a latency budget and GitHub-issue alerts |
| End to end | Playwright ([`e2e/`](e2e/README.md)) | key journeys, a few minutes | The real app, in a phone-sized browser, against a real database |
| Production monitoring | Playwright canary ([`canary/`](canary/README.md)) + Sentry | one journey every 30 min, ~2 min; errors as they happen | The deployed app still works for a user, from the outside (sign in, diary, log and delete a food, ask the trainer), with a GitHub issue per outage; and the errors real use hits, with the release and a readable stack, scrubbed of anything personal (see [Production monitoring](#production-monitoring)) |
| Android app | Maestro ([`.maestro/`](#android-tests)) | 9 flows on an Android emulator, ~13 min job; app PRs + nightly | The installed phone app (Capacitor shell + WebView), as a phone user drives it: sign in, log, edit, delete, weigh in, force-stop and reopen, airplane mode and sync-once, the back button, a wrong password, leaving a workout; each flow also checks what reached the database |
| End to end (Java) | Selenium + TestNG + Cucumber + REST Assured ([`e2e-java/`](e2e-java/README.md)) | 17 tests, ~2 min | The core journeys (sign in, log / edit / delete a food, totals, weigh-in) a second way, in a small interview-style Java framework: page objects, explicit waits only, a browser and a user per test, Allure report |
| Performance | k6 ([`perf-tests/`](perf-tests/README.md)) | smoke on every PR (~2 min); load + soak nightly; stress and spike by hand | The backend holds its latency and error budgets under realistic user journeys at expected load, degrades predictably past it, and doesn't drift over a long run |

One command runs them all, bottom of the pyramid first, stopping at the first failing layer:

```bash
make test          # or, without make: bash scripts/test-all.sh test
```

| Command | Runs |
|---|---|
| `make stack-up` / `make stack-down` | The local Supabase stack in Docker (shared by the API and E2E suites) |
| `make test-unit` | Vitest (`npm test`; `npm run test:watch` while iterating) |
| `make test-contracts` | Contract tests: consumer + Pages Functions offline (`npm run test:contracts`), then PostgREST + Auth against the local stack (`npm run test:contracts:supabase`) |
| `make test-api` | The API suite, with JUnit XML and Allure results in `reports/` |
| `make test-ai` | The AI trainer evals, tier 1 (deterministic, no API key) |
| `make eval-ai-live` | The AI trainer evals, tier 2: the real Claude API, capped (needs a key; see `ai-evals/README.md`) |
| `make canary-prod` | The production AI canary once, by hand: ten cases through the deployed trainer, capped at $0.25 (needs `ai-evals/.env.canary`; see `ai-evals/README.md`) |
| `npm run canary` | The production app canary once, by hand: the user journey through the live site as the monitor account (same `ai-evals/.env.canary`; see [`canary/README.md`](canary/README.md)) |
| `make test-e2e` | Playwright, in its container |
| `bash .maestro/ci/run.sh` | The Android UI flows on a running emulator (`REPEAT=5` for a flake hunt; setup in [Android tests](#android-tests)) |
| `make test-java` | The Java E2E suite (Selenium + TestNG + Cucumber + REST Assured) against the local stack, Allure results in `e2e-java/target` |
| `make test-security` | Security scans: gitleaks, npm audit, pip-audit and an OWASP ZAP baseline scan (report only) |
| `make report` | Builds and opens the Allure report of the last API and AI-eval runs |
| `make perf-smoke` / `perf-load` / `perf-stress` / `perf-soak` | The k6 scenarios against the local stack (see Performance tests); `make perf-clean` removes a stopped run's users |

A `tsc + vite` build check is run before every commit to keep the tree type-safe. Security issues the suites and scans have found, and how each was fixed, are tracked in [`SECURITY-FINDINGS.md`](SECURITY-FINDINGS.md); what the AI trainer evals found is in [`AI-SAFETY-FINDINGS.md`](AI-SAFETY-FINDINGS.md).

### Contract tests

The frontend talks to two providers it does not deploy with: Supabase (PostgREST and Auth, called straight from the browser with supabase-js) and four Cloudflare Pages Functions under `/api/*`. The unit tests can't see that boundary and the E2E suite only sees it through the screen, so [`contracts/`](contracts) holds **consumer-driven contract tests** that pin it down from the app's side.

**How it works.** The consumer tests (`contracts/consumer/`) run the app's own code — `signInWithPassword`, the diary's TanStack mutations, `fetchDiaryDay`, `askTrainer`, `scanPlate` — against a recording stand-in for the provider. Each test states the request the app must make and an example answer, then checks the app sent exactly that and read the example correctly. The recorded interactions are written to two reviewable files, `contracts/fitlog-web--supabase.json` and `contracts/fitlog-web--pages-functions.json`: the request as sent (secrets as `{{placeholders}}`), the status, the response fields the app reads as a JSON Schema, and the provider states each needs. The provider verifications then replay those files:

- `contracts/provider/functions.verify.test.ts` calls the real handlers in `functions/api/` in-process, with the sign-in check and the Claude API scripted from the provider states (no wrangler, no network, milliseconds).
- `contracts/provider/supabase.verify.test.ts` reads PostgREST's OpenAPI description of the live local database and checks every column the app reads or writes still exists with a compatible type and nullability, then sends each recorded request for real as a user created for the run and validates the answer. It refuses any URL that isn't the local stack.

**What's covered** (24 interactions): sign-in and the 400 the login page shows; the current user; logging a food (and the 409 duplicate case the offline queue relies on); reading a day; editing servings, editing an entry, deleting one and several; the three reads behind the daily summary (entries, cardio calories, profile) and the profile update; the Ask-a-trainer stream with its 400/401/502/503; the meal-photo scan with its 400/401/422/503.

```bash
npm run test:contracts            # consumer tests + Pages Functions verification, offline, ~10 s
npm run db:start                  # once; then point the Supabase half at it:
source api-tests/scripts/local-env.sh && npm run test:contracts:supabase
make test-contracts               # both halves
```

**When it fails.** The message names the interaction, the route and the field. A *provider* verification failure means the API or the database no longer gives the frontend what it reads: fix the provider (or the schema), or, if the change is intended, change the frontend and its consumer test together. A *consumer* test failure saying the contract file is out of date means the app's needs changed: review the diff with `npm run contracts:update`, commit the new file, and run both provider verifications against it. Never edit the `.json` files by hand; they are generated.

### End-to-end tests in Docker

The E2E suite ([`e2e/`](e2e/README.md)) drives the real app in Chromium at a phone viewport through the key user journeys (sign in, log a meal, search and add foods including a stubbed USDA import, build and log recipes, create and start workout templates, run a program rotation, log cardio and record a GPS walk with a fake GPS, edit and delete entries, create foods, set profile goals and macros, save meals and copy days, ask the AI trainer (stubbed), export and restore a backup, log a workout, log body weight). It also checks Row-Level Security directly against the database API. Everything runs in containers:

- **Test database:** the Supabase CLI's local stack (Postgres, Auth, PostgREST and Storage in Docker), built from the same `supabase/schema.sql` as production, including its RLS policies. `supabase/seed.sql` adds two test users. Tests never touch a hosted project, and `e2e/support/env.ts` refuses to run against any non-local URL.
- **Test runner:** Microsoft's official Playwright image, pinned to the exact `@playwright/test` version (`e2e/Dockerfile`). It runs the Vite dev server and the browser inside the container.

With Docker running, one command runs the whole suite:

```bash
npm run test:e2e:docker   # start the test DB, build the runner image, run all tests
```

The HTML report lands in `playwright-report/` on your machine (`npx playwright show-report`). Stop the database with `npm run db:stop`, or restore it to the seed state with `npm run db:reset`.

```mermaid
flowchart LR
  subgraph Host["Your machine or a GitHub Actions runner"]
    subgraph Runner["Playwright container (e2e/Dockerfile)"]
      PW[Playwright tests] --> CH[Chromium, phone viewport]
      CH --> VITE[Vite dev server]
      PW -. RLS + DB assertions .-> API
    end
    subgraph DB["Supabase local stack (supabase start)"]
      API[API gateway :54321] --> AUTH[Auth]
      API --> REST[PostgREST]
      AUTH --> PG[(Postgres + RLS<br/>schema.sql + seed.sql)]
      REST --> PG
    end
    CH -- host.docker.internal --> API
    Runner -- report volume --> REPORT[playwright-report/]
  end
```

### Android tests

The phone app is a Capacitor shell around the web app. [`.maestro/`](.maestro/README.md) drives that real Android app with [Maestro](https://docs.maestro.dev) on an Android 14 emulator, through taps, typing, the hardware back button, airplane mode and app restarts, against the same throwaway local Supabase stack as the E2E suite.

**What's covered:** nine flows a phone user hits:
- signing in;
- logging a food and checking its row, meal total, calories remaining and macros;
- editing then deleting an entry;
- a weigh-in;
- force-stopping and reopening, still signed in with the data intact;
- logging offline in airplane mode, then syncing exactly once;
- the back button through tabs, an unsaved edit and the app's root;
- a wrong password;
- leaving a workout with a changed set: back asks first, and Discard undoes the change.

Each flow checks the screen and, through a small script, what reached the database. It signs in for itself, uses run-unique names, and wipes its test account before and after.

**How it reaches the stack:** a test APK, the same native shell with `CAP_SERVER_URL` set, loads the web build from the host over `adb reverse`. The build talks to Supabase at `10.0.2.2`, the emulator's address for the host, so airplane mode really cuts it. The phone's own APK and the dev and production sites are never involved.

**In CI:** [`android-ui.yml`](.github/workflows/android-ui.yml) runs on pull requests that touch the app and nightly, in parallel with `ci.yml` and outside the deploy gate, with no retries. A manual run takes a repeat count for flake hunts. The job summary lists each flow's passes and first failure.

**Run it locally** with an AOSP API 34 emulator running, the [Maestro CLI](https://docs.maestro.dev) and Docker. The commands below build and serve the web app against the local stack; [`.maestro/README.md`](.maestro/README.md) covers getting the test APK.

```bash
npm run db:start && source api-tests/scripts/local-env.sh
VITE_SUPABASE_URL=http://10.0.2.2:54321 VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY VITE_USDA_API_KEY=x npm run build
npx vite preview --host 127.0.0.1 --port 5174 --strictPort &
export MAESTRO_SUPABASE_URL=$SUPABASE_URL MAESTRO_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY MAESTRO_FITLOG_EMAIL=kim@e2e.test MAESTRO_FITLOG_PASSWORD=kim-password
APK=path/to/app-debug.apk bash .maestro/ci/run.sh
```

**When a flow fails:**
1. Read the job summary. It names the flow and its first failing step.
2. Download the `android-ui-failure` artifact. It holds a screenshot and screen dump of the failing step, Maestro's log and the device log.
3. Rerun that one flow locally, and use `maestro studio` to inspect the live screen.

[`.maestro/README.md`](.maestro/README.md) has a table of symptoms and their likely causes.

### Performance tests

[`perf-tests/`](perf-tests/README.md) is a small k6 framework (TypeScript, no bundler) that replays FitLog's real user journeys — open the diary, search for and log a meal, log a workout set by set, log a weigh-in, ask the trainer — against the same disposable local stack, with think time between actions and per-run users seeded with months of history. Four scenarios share one journey mix: **smoke** (2 users, a minute; gates every PR), **load** (30 users, 5 minutes steady), **stress** and **spike** (up to 300 users, report-only: where does it break?) and **soak** (expected load held for an hour, with a drift check). Latency and error budgets are set per endpoint group with a written rationale, a breach fails the run, and every run's headline numbers (p95/p99, error rate, throughput, which budgets held) go to the quality dashboard's Performance section. It refuses to run against anything but the local stack, stubs Claude, never reaches USDA, and deletes its users afterwards.

```bash
make perf-smoke     # ~2 min; make perf-load, perf-stress, perf-soak (SOAK_DURATION=10m to shorten)
```

### CI/CD pipeline

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and every push to `dev` or `main`:

```mermaid
flowchart LR
  PUSH[Push / PR] --> UNIT[Unit: build + Vitest]
  PUSH --> API[API: supabase start, functions + Claude stub, pytest]
  PUSH --> E2E[E2E: supabase start, then Playwright container]
  PUSH --> SEC[Security scans: gitleaks, npm audit, pip-audit, ZAP]
  PUSH --> PERF[Perf smoke: supabase start, functions + stub, k6]
  PUSH --> CONTRACTS[Contracts: consumer + functions offline, then supabase start + replay]
  API --> ALLURE[Allure report artifact]
  E2E -- on failure --> ART[Report uploaded as artifact]
  UNIT --> GATE{All three passed and branch is main?}
  API --> GATE
  E2E --> GATE
  CONTRACTS --> GATE
  GATE -- yes --> DEPLOY[wrangler pages deploy to fitlog-prod]
  UNIT -. results .-> METRICS[Quality metrics: job summary + dashboard]
  API -. JUnit XML .-> METRICS
  E2E -. results .-> METRICS
  SEC -. report only .-> SUMMARY[Job summary + artifact]
  PERF -. fails the PR, not the deploy .-> SUMMARY
  DEPLOY -. after every deploy, then every 30 min .-> APPCANARY[Production app canary: the user journey through the live app]
  DEPLOY -. twice a day .-> CANARY[Production AI canary: 10 cases through the live trainer]
  APPCANARY -. on failure .-> APPALERT[GitHub issue labelled prod-app-canary]
  CANARY -. on failure .-> ALERT[GitHub issue labelled prod-ai-alert]
  APPCANARY -. results .-> METRICS
  CANARY -. results .-> METRICS
  DEPLOY -. errors in real use .-> SENTRY[Sentry: browser + Pages Functions, scrubbed, tagged with the commit]
```

Production is only deployed from `main`, and only after the unit, API, E2E and contract jobs all pass. The API job runs in parallel with E2E on its own runner, so it adds no time to a release. The security scans and the metrics job report on every run but are deliberately outside the release gate: findings are reviewed and fixed as their own changes, not by blocking a deploy. The performance smoke job fails a PR's checks but is not a `deploy-prod` dependency. The `dev` site still auto-deploys through Cloudflare's Git integration.

A second workflow, [`perf.yml`](.github/workflows/perf.yml), runs the load scenario and a 10-minute soak against `dev` every night and publishes their headline numbers to the dashboard; by hand it runs any scenario (stress, spike, a long soak) on any branch.

After a release, two canaries and Sentry keep watching; what they check, how often, where alerts go and how to pause them is in [Production monitoring](#production-monitoring). They are monitors, not gates: none can block or slow a deploy.

### Quality metrics dashboard

**Live dashboard: [kakaul94-prof.github.io/FitLog](https://kakaul94-prof.github.io/FitLog/)**

Every CI run records its results so quality can be tracked over time, not just pass/fail per build.

| Tracked | How |
|---|---|
| Pass rate per suite | Unit, API and E2E: tests that passed (including after a retry) ÷ tests run, per CI run |
| Feedback time | From the push (or PR update) until every suite's results are in |
| Flaky rate + top flaky tests | Tests that failed, then passed on a retry; ranked by how often across runs |
| Suite duration + slowest 10 tests | Wall-clock time per suite; each slow test against its own 10-run average |
| Last run status | Result, branch, commit link and per-job outcome, including infrastructure failures with no test results |
| AI evals, live tier | Rule-check pass rate per category, cost, p50/p95 latency per run and per category against its budget (informative), and the fairness groups' parity |
| Production app canary | Uptime over 24 h, 7 and 30 days, journey p50/p95, p50/p95 and failures per step, and every run with its trigger and alert, from the user journey through the live app every 30 minutes; the open-alert status read live from GitHub |
| Production AI canary | Pass rate, calls answered, p50/p95 latency and estimated cost per run through the live production trainer, twice a day, with the open-alert status read live from GitHub |

**How flaky detection works.** In CI Playwright retries a failing test up to twice. Playwright then marks a test that failed and later passed as `flaky`, and the metrics keep that status rather than counting it as a pass. Retries keep a release from being blocked by a one-off timing problem without hiding it, and the dashboard shows which tests rely on them. Unit tests run with no retries on purpose, because they should be deterministic. For flakes rare enough to slip past retries, the manual [Flake hunt](.github/workflows/flake-hunt.yml) workflow runs every E2E test N times with retries off and ranks tests by failure rate.

**How it's built** ([`metrics/`](metrics)):

1. Playwright and Vitest each write a JSON report and the API suite writes JUnit XML, next to their usual output, and each job uploads it as an artifact, even when tests fail.
2. A `metrics` job turns the reports into one record per run (timestamp, commit, branch, totals, durations, per-test times) and writes a results table to the run's job summary, PRs included. One small adapter per tool maps its report into a shared shape, so adding a new tool means adding one adapter (`metrics/adapters/`).
3. On pushes to `main` and `dev`, the record is appended to `data/history.json` on the `gh-pages` branch (capped at 200 runs, ~0.6 MB), which GitHub Pages serves with a static Chart.js page. Git acts as the database, so there is no server and no paid service, and history is versioned. The alternative was deploying the page as a build artifact and re-downloading the previous history each time. That avoids bot commits, but one failed download would wipe the history.

The `metrics` job is outside the release gate: `deploy-prod` depends only on the three test jobs, the metrics job has `continue-on-error`, and it runs alongside the deploy. A metrics failure can't block or slow a release. Records contain test names, statuses, durations and public run links only; no error text, logs or environment values are published.

## Production monitoring

Shift-right: the suites prove a release before it ships; these watch what shipped.

| What | Checks | How often | Alerts |
|---|---|---|---|
| **App canary** ([`canary/`](canary/README.md), [`app-canary.yml`](.github/workflows/app-canary.yml)) | A phone-sized Chromium signs in to the live site as a dedicated monitor account, loads today's diary, logs a 1 kcal food and reads it back from the database, deletes it and reads that back, and asks the trainer one question | Every 30 minutes (the trainer on the hour only), after every production deploy, and on demand; about 2 minutes a run | A GitHub issue labelled `prod-app-canary`: one per outage, opened by the first failing run with the step, the error and the Playwright trace, commented on while it lasts, closed by the first run that recovers |
| **AI canary** ([`ai-evals/README.md`](ai-evals/README.md#production-canary-shift-right), [`prod-canary.yml`](.github/workflows/prod-canary.yml)) | Ten of the trainer evals' cases through the live trainer, scored by the evals' own rule checks, with a latency budget | Twice a day; capped at $0.25 a run (about $0.05) | A GitHub issue labelled `prod-ai-alert`, one for the endpoint failing or slow, one for answers below the quality bar |
| **Error tracking** (Sentry: [`src/lib/monitoring.ts`](src/lib/monitoring.ts), [`functions/api/_middleware.ts`](functions/api/_middleware.ts)) | Uncaught errors in the browser (the error boundaries included) and in the Pages Functions, tagged with the environment and the commit (`release`), with source maps uploaded by the production deploy so stack traces read as source | As they happen; errors only, no tracing, no session replay | Sentry's own new-issue email |

Both canaries use one monitor account that holds nothing else; everything the app canary writes is named `Canary check …`, deleted in the same run, and swept at the start of the next, and every table is RLS owner-only, so it cannot touch a real user's data. A missing secret **fails** a canary run on every trigger, the schedule included; [`canary/workflows.test.mjs`](canary/workflows.test.mjs) keeps it that way. Every run is appended to the [quality dashboard](https://kakaul94-prof.github.io/FitLog/), which shows uptime and per-step latency.

Sentry is privacy-first because this is health data: [`shared/scrub.ts`](shared/scrub.ts) drops request bodies, query strings, cookies, auth headers and the user object, redacts emails, tokens and food or body quantities everywhere else, and is proven by [`shared/scrub.test.ts`](shared/scrub.test.ts). It is off in `npm run dev`, in every test run and in CI builds (no DSN, not a production build), and capped at 20 events per page load.

**Pause the canaries:** `gh workflow disable "Production app canary"` (and `"Production AI canary"`); `gh workflow enable` resumes. Open alert issues stay open until a run recovers. **Set-up** (once): a monitor user in the production Supabase project and the `PROD_CANARY_EMAIL` / `PROD_CANARY_PASSWORD` repository secrets for the canaries; for Sentry, `PROD_VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (secrets) and `SENTRY_ORG`, `SENTRY_PROJECT` (variables) for the deploy, plus `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and the `nodejs_als` compatibility flag on the Pages project (see Deployment).

## Getting Started

### Prerequisites

- Node.js 20.19+ (Vite 8)
- Docker Desktop (for the API and E2E suites)
- Python 3.12+ (for the API suite)
- A [Supabase](https://supabase.com) project (Postgres + Auth)
- A [USDA FoodData Central](https://fdc.nal.usda.gov/api-key-signup.html) API key (for food import)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/kakaul94-prof/FitLog.git
cd FitLog
npm install

# 2. Configure environment (create a .env file)
cp .env.example .env   # then fill in the values below
```

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_USDA_API_KEY=your-usda-api-key
```

```bash
# 3. Apply the database schema
#    Run supabase/schema.sql in the Supabase SQL Editor (it's idempotent)

# 4. Run it
npm run dev       # http://localhost:5173
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production (`tsc` + `vite`) |
| `npm test` | Run the unit test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e:docker` | Start the local test DB and run the E2E suite in Docker |
| `npm run test:e2e` | Run the E2E suite on the host (needs `npm run db:start`) |
| `npm run canary` | Run the production app canary once against the live site (see Production monitoring) |
| `npm run db:start` / `db:stop` / `db:reset` | Manage the local Supabase test stack |
| `make test` / `test-api` / `test-ai` / `test-security` / `report` | Every test layer, the API suite, the AI evals, the security scans, the Allure report (see Testing) |
| `make perf-smoke` / `perf-load` / `perf-stress` / `perf-soak` / `perf-clean` | The k6 performance scenarios (see Performance tests) |

## Deployment

FitLog deploys to **Cloudflare Pages**. The `dev` branch auto-deploys to the dev site through Cloudflare's Git integration. Production (`fitlog-prod`) is deployed by the CI workflow's `deploy-prod` job with `wrangler pages deploy`, only after the unit, API and E2E jobs pass on `main`. SPA deep links are handled via `public/_redirects`.

The deploy job reads these GitHub repository secrets and skips itself until `CLOUDFLARE_API_TOKEN` exists:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with the *Cloudflare Pages: Edit* permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `PROD_VITE_SUPABASE_URL` / `PROD_VITE_SUPABASE_ANON_KEY` / `PROD_VITE_USDA_API_KEY` | The production build variables (the same values set in the `fitlog-prod` Pages project) |
| `PROD_VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (secrets); `SENTRY_ORG`, `SENTRY_PROJECT` (variables) | Optional. The Sentry DSN baked into the production bundle, and what uploads the build's source maps under the commit SHA |
| `PROD_CANARY_EMAIL` / `PROD_CANARY_PASSWORD` | The production monitor account the canaries sign in as (not used by the deploy) |

Once the secrets are set, turn off automatic production deployments for `fitlog-prod` in Cloudflare (Settings → Build → Branch control), so the gated CI job is the only way to production.

The Pages Functions read `SENTRY_DSN` and `SENTRY_ENVIRONMENT` from the Pages project's variables at runtime and need the **`nodejs_als` compatibility flag** (Settings → Functions → Compatibility flags) for Sentry's SDK; the deploy job checks the flag on `fitlog-prod` and refuses to deploy without it, since every `/api` route would fail. The dev project (`fitlog`) wants the same flag, plus `VITE_SENTRY_DSN` and `VITE_SENTRY_ENV=dev` as build variables if dev errors should reach Sentry too.

## Project Structure

```
src/
├── pages/         # one component per route
├── features/      # TanStack Query hooks, grouped by domain area
├── lib/           # pure logic: calc, nutrients, progression, date, supabase client
├── components/    # UI primitives + layout (AppLayout, BottomNav, shared panels)
└── data/          # built-in activities & exercises
supabase/
├── schema.sql     # idempotent schema + RLS policies
├── seed.sql       # E2E test users + data (local stack only)
└── config.toml    # Supabase CLI local stack
e2e/
├── Dockerfile     # Playwright runner image
├── pages/         # Page Objects
├── tests/         # user-journey specs + RLS spec
└── support/       # local-only env guard, Supabase API client
canary/            # production app canary: the journey through the live site, alerts, publish, their tests
shared/            # code the browser AND the Pages Functions use: Sentry scrubbing, the release tag
e2e-java/
├── pom.xml        # Selenium + TestNG + Cucumber + REST Assured, Allure
├── scripts/       # start-app.sh (local stack env + Vite on :5174), run.sh
└── src/test/      # pages/, tests/, cucumber/, resources/features/
testkit/           # shared Python package (fitlog-testkit): clients, token forger, factories, contracts, Claude stub
api-tests/
├── tests/         # auth, authz, contracts, validation, security, functions, bdd
└── scripts/       # local-env.sh, start-functions.sh
ai-evals/
├── dataset/       # personas + 68 eval cases (YAML), rubrics/, calibration/
├── canary/        # the production canary's ten cases + snapshot fixture
├── harness/       # the app's own trainer code, bundled for Node
├── aievals/       # checks, judge, proxy, live runner, canary + alerts, calibration
└── tests/         # tier 1: injection, exposure, actions, output, failures, canary, alerts
perf-tests/
├── config/        # scenario profiles (VUs, durations, seed), budgets + thresholds, endpoint registry
├── lib/           # local-only guard, PostgREST request builder, auth, seeding, journey mix, summary
├── journeys/      # viewDiary, logMeal, logWorkout, logWeight, askTrainer + the weighted mix
├── scenarios/     # smoke, load, stress, spike, soak (a few lines each)
└── run.sh         # stack guard → functions + stub → k6 (native or Docker) → verdict → clean-up
metrics/           # CI quality metrics, performance, canary + security-scan history and the dashboard
scripts/           # test-all.sh (behind the Makefile), security-scan.sh
compose.yaml       # `e2e` service (docker compose run e2e)
Makefile           # make test, test-api, test-ai, eval-ai-live, canary-prod, test-security, report, perf-* ...
```

## Notes

FitLog is a personal project, built and maintained solo. The Supabase anon key is safe to expose in the client because access is fully governed by Row-Level Security policies.
