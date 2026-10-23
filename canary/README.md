# Production app canary

The journey a real user makes, through the **live** app, as a dedicated
monitor account, every 30 minutes and after every production deploy. The test
suites prove a release before it ships; this proves the shipped app still works
for a user, from the outside. It is a monitor, not a gate: nothing here can
block or slow a deploy.

## What it checks

One Playwright test ([`tests/canary.spec.ts`](tests/canary.spec.ts)) in a
Pixel-7-sized Chromium, reusing the E2E suite's page objects, in five steps:

| Step | What must be true |
|---|---|
| Sign in | The real email + password form signs the monitor in and the Diary tab appears |
| Load the diary | Today's diary query answers 200; the calorie ring and the Snacks meal render |
| Log a food entry | Quick-add "Canary check *run*" at 1 kcal into Snacks; the row shows in the diary **and** is read back over REST with the right name, meal, date and calories |
| Delete the entry | Press and hold → Delete entry; the row is gone from the diary **and** from the database |
| Ask the trainer | One fixed question to `/lift/trainer`; the endpoint answers 200, the stream finishes, and the last bubble is a real answer (not an error, not cut off) |

Each step is a `test.step`, so the report, the alert and the dashboard say
which one failed. One retry: a dropped connection should not open an alert,
but a run that needed the retry is recorded as **flaky**, never as a clean pass.

## What it does to production, and nothing else

A sign-in and a sign-out of the monitor account, one 1 kcal diary entry that
the same run deletes, and on the hour one POST to `/api/trainer`, which writes
nothing. Entries are named `Canary check …` so leftovers are recognisable; the
run sweeps them before it starts and after it ends, so a crashed run can leave
at most one row for the next run to remove. Every table is RLS owner-only, so
the monitor cannot see or touch a real user's rows, and the account holds
nothing else: it is always safe to delete. The trainer chat persists on the
device, which here is a throwaway browser context.

## Schedule and cost

| Trigger | Trainer step | Why |
|---|---|---|
| `0 * * * *` (on the hour) | yes | One Claude call, about $0.003: 24 a day, about $2 a month |
| `30 * * * *` (on the half hour) | no | The app checks every 30 minutes without doubling AI spend |
| CI finishing green on `main` | yes | That is a production deploy; the first run checks what just shipped |
| Run workflow (manual) | your choice | Also where the drill lives |

GitHub Actions minutes are free for this public repository; a run takes about
two minutes. The schedule only runs from the default branch, and GitHub
switches it off after 60 days without a commit; the dashboard's "last run"
tile shows either.

## When it fails

[`alerts.mjs`](alerts.mjs) keeps **one GitHub issue per outage**, labelled
`prod-app-canary`: the first failing run opens it (and the label), with the
failing step, the error, the trigger, every step's result and a link to the
workflow run, whose `app-canary` artifact holds the Playwright trace
(`test-results/**/trace.zip`, open with `npx playwright show-trace`), the
screenshot and the HTML report. Each later failing run comments on that issue
instead of opening another; the first run that passes comments and closes it.
Issues with the label that the canary did not open (no marker) are left alone.

Every run is summarised ([`summarize.mjs`](summarize.mjs)) and appended to
`data/app-canary.json` on the `gh-pages` branch ([`publish.sh`](publish.sh),
[`append.mjs`](append.mjs), newest 2,000 runs), which the
[quality dashboard](https://kakaul94-prof.github.io/FitLog/) charts: uptime
over 24 h, 7 and 30 days, journey p50/p95, time per step, and every run with
its trigger and alert.

## It cannot skip

A missing secret **fails** the run, on every trigger, the schedule included,
naming what is missing. The first version of the AI canary's workflow turned a
missing secret into a warning on scheduled runs, and twelve runs showed green
while no canary ever ran. [`preflight.test.ts`](preflight.test.ts) proves
[`env.ts`](env.ts) throws for every blank variable, and
[`workflows.test.mjs`](workflows.test.mjs) reads both workflow files and fails
if the gate ever warns, skips, or treats scheduled runs differently again.

## Set-up (once)

1. In the **production** Supabase project: Authentication → Users → Add user.
   An address nobody reads, a long random password, *Auto Confirm User* on.
   Never sign in as it anywhere else.
2. Repository secrets `PROD_CANARY_EMAIL` and `PROD_CANARY_PASSWORD`
   (`PROD_VITE_SUPABASE_URL` and `PROD_VITE_SUPABASE_ANON_KEY` already exist for
   the deploy). The AI canary uses the same two.
3. Optional: a `PROD_SITE_URL` repository variable if the site ever moves from
   `https://fitlog-prod.pages.dev`.

## By hand

The same variables the workflow passes, in the environment or in
`ai-evals/.env.canary` (gitignored, shared with the AI canary):

```
CANARY_SITE_URL=https://fitlog-prod.pages.dev   # optional; the dev site for a rehearsal
CANARY_SUPABASE_URL=https://<ref>.supabase.co
CANARY_SUPABASE_ANON_KEY=sb_publishable_…
CANARY_EMAIL=…
CANARY_PASSWORD=…
```

```bash
npm run canary                         # the journey once; reports/app-canary/{html,playwright.json}
CANARY_TRAINER=false npm run canary    # without the trainer step
CANARY_DRILL=selector npm run canary   # fails on purpose at "Load the diary"
node canary/summarize.mjs reports/app-canary/playwright.json reports/app-canary/summary.json
```

Running the alert step by hand needs `GITHUB_TOKEN` (issues: write) and
`GITHUB_REPOSITORY`: `node canary/alerts.mjs reports/app-canary/summary.json`.

## Proving the alerting

Run workflow → *drill: selector*. The run asserts a heading the app has never
had, fails at "Load the diary" before anything is written, and opens the issue
with a note that it was a drill. The next scheduled run passes and closes it.
On the dashboard, drills are listed but kept out of the uptime figures.

## Pausing

```bash
gh workflow disable "Production app canary"
gh workflow enable "Production app canary"
```

An open alert stays open until a run recovers; close it by hand if the pause is
deliberate.
