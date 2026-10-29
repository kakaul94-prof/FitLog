# FitLog performance tests

Load, stress, spike and soak tests for FitLog's backend, written for [k6](https://grafana.com/docs/k6/latest/)
in TypeScript. They replay the app's real user journeys against the **local Supabase
stack only**, with think time, per-run users seeded with months of history, Claude
stubbed and USDA never called, and they fail when a latency or error budget is breached.

```bash
make perf-smoke     # 2 users, a minute: do the scripts and the stack work?  (~2 min with setup)
make perf-load      # 30 users, 5 minutes steady: the baseline                 (~8 min)
make perf-stress    # 30 → 300 users in steps, then a 10 → 250 spike           (~14 min, report-only)
make perf-soak      # 30 users for an hour (SOAK_DURATION=10m to shorten)      (~63 min)
make perf-clean     # delete any @perf.test users a stopped run left behind
```

Without `make`: `bash perf-tests/run.sh <smoke|load|stress|spike|soak|cleanup>`.

## Prerequisites

- Docker, and the local stack running: `make stack-up`.
- Node 22 with `npm ci` done at the repo root (the Supabase CLI and wrangler, which runs
  the Pages Functions, are dev dependencies) and in `perf-tests/` (types for `npm run typecheck`).
- Python 3.12+ with the testkit installed, for the Claude stub: the API suite's
  virtualenv (`api-tests/.venv`, see the root README) already has it; otherwise
  `pip install -e ./testkit`. Or skip the trainer journey with `PERF_NO_FUNCTIONS=1`.
- k6 itself is optional: `run.sh` uses the native binary when it is on `PATH`, and
  otherwise runs the pinned `grafana/k6` image on the stack's Docker network. CI
  installs it natively.

## What runs: the journeys

Every scenario runs the same weighted mix (`journeys/index.ts`). Each iteration, a virtual
user picks one journey by weight and runs it start to finish, pausing between actions as a
person would (`lib/think.ts`), then pauses before the next. The requests are the app's own:
each journey was written from the TanStack Query hooks the page uses (named in each file),
including which queries a page fires together (`http.batch`).

| Journey | Weight | What it does | Requests |
|---|--:|---|--:|
| `viewDiary` | 35% | Open the Diary tab: today's entries and cardio, the profile, the latest weigh-in and the streak scan, all at once; read | 5 |
| `logMeal` | 30% | Open the food picker (history, library, saved meals), type a search in two keystrokes, pick a result, set a serving, log 1–2 rows, watch the day and streak refetch | 8 |
| `logWorkout` | 20% | Open the Lift tab, start a session, add two lifts (position, last time's sets, goal, blank sets), fill each set in between rests, mark it done, look at it | ~26 |
| `logWeight` | 10% | Open the weight page (latest + history), type a number, save it, see it refetch | 4 |
| `askTrainer` | 5% | Ask `/api/trainer` a question with a realistic training-log snapshot; Claude is the testkit stub, so this measures our overhead as time-to-first-byte | 1 |

Rests between sets are compressed to 8–15 s (a real rest timer is 90 s) so a workout
journey takes about a minute rather than ten; everything else is at human speed.

Each run seeds its own users (`lib/seed.ts`): ~150 foods, ~10 diary rows a day, a 4-lift ×
3-set workout every other day, a daily weigh-in and cardio twice a week, for `seedDays`
days. 90 days is a committed user with ~1,000 diary rows, which is what the streak scan and
the "recent foods" query have to chew through; a fresh empty user would make every query
trivially fast. Virtual users share the seeded pool round-robin, each with its own session.

## The scenarios

| Scenario | Shape | Seed | Budgets | Runs |
|---|---|---|---|---|
| **smoke** | 2 users for 1 min, pauses ×0.25 | 3 users × 14 days | enforced, **zero** errors; latency relaxed in CI | every PR and push (`ci.yml`) |
| **load** | ramp to 30 users in 1 min, hold 5 min | 30 × 90 days | enforced | nightly on `dev` (`perf.yml`), by hand |
| **stress** | 30 → 100 → 200 → 300 users, 2 min per step | 60 × 90 days | report-only; aborts once errors stay > 10% | by hand |
| **spike** | 10 users, 250 within 10 s, 1 min at the top, back to 10 for 2 min | 60 × 90 days | report-only | by hand |
| **soak** | ramp to 30, hold `SOAK_DURATION` (60 m; 10 m nightly), + drift check | 30 × 90 days | enforced | nightly (10 m), by hand |

**"Expected load" is 30 concurrent users.** FitLog has one real user today, so this is a
deliberately generous planning target, not a measurement; change `EXPECTED_VUS` in
`config/profiles.ts` when there is data. Every target can be scaled with `VUS=<n>`.

Report-only scenarios still declare every budget, so the summary shows which ones broke at
which step; the point is the curve, not a pass mark, and `run.sh` exits 0 for them unless
the run itself failed (a crash, a timeout). Stress aborts itself once the error rate stays
above 10% for 90 s: past that the numbers describe a dead stack, not a slow one.

## The budgets

Latency is measured by k6 on the same machine as the stack, so these are server-side
numbers; a phone adds 50–150 ms of network on top. From `config/thresholds.ts`:

| Group | p95 | p99 | Why this number |
|---|--:|--:|---|
| `search` (food typeahead) | 200 ms | 500 ms | The picker fires a query per keystroke; a result that lands after the next keystroke is wasted |
| `read` (page queries) | 250 ms | 600 ms | A tab should open in about a second on a phone: ~150 ms of network and ~400 ms of rendering five parallel queries leaves ~250 ms for the slowest query |
| `write` (inserts, updates) | 400 ms | 1000 ms | Writes are optimistic in the UI, so they only have to land before the next read; they pay for the RLS check, index updates and row locks |
| `auth` (token refresh) | 500 ms | 1000 ms | Runs in the background every ~55 min per session; must not stall the next request, but nobody is watching it |
| `fn` (`/api/trainer`, time to first byte) | 1000 ms | — | With Claude stubbed this is the sign-in check (one GoTrue round trip) plus prompt assembly |
| Errors (journey requests) | ≤ 0.5% (smoke: 0) | | A failed request is a failed tap; half a percent is already one per 200 |
| Checks (expected status + body) | ≥ 99% (smoke: 100%) | | A 200 with the wrong body is still a bug |
| Soak drift | last-third p95 ≤ 1.25 × first-third p95, or less than 50 ms above it | | Leaks, pool exhaustion and bloat show as a slow climb of tens to hundreds of ms; the absolute floor keeps a 46 → 61 ms wobble from failing a run |

Every endpoint also carries its group's p95 as its own threshold, so one slow query can't
hide behind a fast group. Sign-ins are reported but not budgeted: they are bcrypt-bound by
design (and the local stack rate-limits them at 300 per 5 minutes).

**CI's smoke run uses relaxed budgets** (`PERF_LAX=1`: p95 < 1 s, p99 < 2.5 s). A shared
GitHub runner's speed varies up to 3× between runs, so the gate there catches regressions
of kind (an endpoint that got 10× slower, errors, a broken journey), while the numbers
that matter come from the nightly run and from local runs. The lax mode is marked in the
summary and on the dashboard.

**If a budget is breached by a real problem** (a slow query, a missing index, an N+1, errors
under load), the budget stays and the fix goes in the app, test-first, with before/after
numbers. Loosening a threshold to make a run pass defeats the point of having one.

## Reading the results

`run.sh` ends with a short table on stdout and a verdict line:

```
  FitLog perf · load · 30 VUs peak · 390s window · 30 users × 90 days
  requests 9 312 (23.9/s) · iterations 1 180 · errors 0.00% · checks 100.00%
  latency  med 31 ms · p90 68 ms · p95 94 ms · p99 171 ms · max 612 ms

  group          p95      p99   errors       n   budget p95/p99
  search       61 ms    98 ms    0.00%     720   200/500 ms
  read         88 ms   160 ms    0.00%    5 840   250/600 ms
  ...
  thresholds: 48 passed, 0 failed
perf: load passed — 48 thresholds held
```

Everything lands in `reports/perf/<scenario>/`:

- `report.html`: k6's own report (timelines of request rate, latency percentiles, VUs and
  errors over the run, per-URL tables). Open it in a browser. The only way to see *when*
  something went wrong, e.g. which stress step broke.
- `headline.json`: the numbers above plus per-group, per-endpoint, per-journey and
  per-phase stats, every threshold's result and the verdict. This is what the dashboard,
  the job summary and `scripts/check-run.mjs` read.
- `summary.json`: k6's full end-of-test summary, every metric and sub-metric.

Requests per second is journey requests divided by the configured run window (ramps and
holds, not setup or teardown), so it understates a run that aborted early.

**The dashboard.** Nightly and manual runs (`perf.yml`) append one record per run to
`data/perf.json` on the `gh-pages` branch, and the quality dashboard
([kakaul94-prof.github.io/FitLog](https://kakaul94-prof.github.io/FitLog/)) shows a
Performance section: the last run's verdict per scenario, p95/p99, error rate and
throughput, which budgets held, a p95 trend per scenario across runs, and the latest run
by endpoint group. PR runs stop at the job summary. The record keeps numbers and names only.

## How a run works

`run.sh` does, in order:

1. Refuses anything but a local stack. In bash first, then again inside k6 (`lib/env.ts`),
   which also decodes both keys and refuses any that carry a hosted project's `ref` claim
   or aren't issued by the local CLI. A hosted URL or key never gets a single request.
2. Exports the stack's URLs and keys from `supabase status` (`api-tests/scripts/local-env.sh`).
3. Starts the Pages Functions with the testkit's recording Claude stub
   (`api-tests/scripts/start-functions.sh`), with the stub told to keep only its newest
   200 calls so a soak can't grow it without bound. If `FITLOG_FUNCTIONS_URL` is already
   set (CI starts them itself), it uses that.
4. Runs the scenario: `setup()` creates and seeds the users, VUs sign in on their first
   iteration (so a spike's sign-ins are part of what is measured, and stay inside the
   stack's rate limit), `teardown()` deletes the users, `handleSummary()` writes the reports.
5. Gives the verdict (`scripts/check-run.mjs`): thresholds, the soak drift, an early end,
   and whether a breach counts in this scenario.
6. Always, even after Ctrl-C: deletes every `@perf.test` user, then stops the functions.

Caps that nothing can override: 400 virtual users, 100 seeded users, 8 hours.

## Adding things

**An endpoint**: one line in `config/endpoints.ts` naming it and its group, e.g.
`'routines.list': 'read'`. The request builder refuses unknown names, so a typo fails at
once. The group gives it a budget, a per-endpoint threshold and a row in the reports.

```ts
rest(ctx.caller).from('routines').select('*').order('name').get('routines.list')
```

**A journey**: a function that takes a `Ctx` (the signed-in user, their `caller` and
`today`, the seeded day, fixed for the whole run: date anything that must match the seed
from it, never from the clock, or a run crossing midnight UTC misses its data) and makes requests through `rest(...)` (one at a time) or `batch([...prepare()])`
(together, as a page does), with `think()` between steps and `expect*()` checks from
`lib/checks.ts`. Then one line in `journeys/index.ts` with its weight. See
`journeys/logWeight.ts` for the smallest example.

**A scenario**: a profile in `config/profiles.ts` (stages, seed size, pauses, enforced or
report-only, error budget) and a five-line file in `scenarios/` that passes its name and a
mix to `defineScenario`. A different mix is just a different array; a scenario that only
hammers one journey is `defineScenario('search', [{ name: 'logMeal', weight: 1, run: logMeal }])`.
Add a `make` target in the root `Makefile` and `scripts/test-all.sh` if people should run it.

**A budget**: `config/thresholds.ts`, with the reason next to the number.

## Knobs

| Variable | Meaning |
|---|---|
| `VUS` | Scale the whole ramp to peak at this many users (cap 400) |
| `SOAK_DURATION` | The soak's steady hold, e.g. `10m`, `4h` (cap 8 h in total) |
| `THINK_SCALE` | Multiply every pause; `0` removes them (a hammer, not a measurement) |
| `POOL_SIZE`, `SEED_DAYS` | Seeded users (cap 100) and days of history each |
| `PERF_LAX=1` | Relaxed latency budgets (what CI sets for the smoke gate) |
| `PERF_NO_FUNCTIONS=1` | Skip the trainer journey; no functions server needed |
| `K6_BIN`, `K6_IMAGE` | Which k6 to run (default: `k6` on `PATH`, else `grafana/k6:2.3.0`) |

`npm run typecheck` in `perf-tests/` type-checks everything (k6 itself only strips types).

## Baseline (2026-10-14, commit `0235474`)

Same code, same seed, same scenarios, two machines. The GitHub-hosted runner is the
reference; the laptop numbers are included because they taught the most.

**Reference: GitHub-hosted runner** (ubuntu-latest, 4 vCPU, SSD; k6 native; the
[Performance workflow](../.github/workflows/perf.yml), run 38602749902):

| Scenario | Requests | Errors | p50 / p95 / p99 | search · read · write (p95) | Trainer TTFB p95 | Sign-in p95 | Budgets |
|---|--:|--:|---|---|--:|--:|---|
| load, 30 users × 5 min | 4,324 · 11.1/s | 0 | 2 / 8 / 77 ms | 4 · 7 · 3 ms | 50 ms | 98 ms | 42/42 held |
| soak, 30 users × 10 min | 7,756 · 11.2/s | 0 | 2 / 8 / 38 ms | 4 · 8 · 3 ms | 57 ms | 102 ms | 42/42 held, drift 0.32× |

Drift below 1 is the ramp: the first third includes thirty sign-ins and cold caches.

**This laptop** (Windows 11, Docker Desktop with 8 vCPU / 8 GB, Postgres on a 5,400-rpm
HDD; k6 in the Docker image on the stack's network):

| Scenario | Requests | Errors | p50 / p95 / p99 | search · read · write (p95) | Sign-in p95 | Budgets |
|---|--:|--:|---|---|--:|---|
| load, 30 users × 5 min | 4,211 · 10.8/s | 0 | 4 / 73 / 961 ms | 6 · 11 · **775** ms | 248 ms | 36/42: every write budget |
| stress, 30 → 300 users | 32,197 · 63/s | 1 (a client abort at ramp-down) | 4 / 127 / 395 ms | 8 · 32 · 332 ms | 402 ms | 43/43 held |
| spike, 10 → 250 users in 10 s | 9,008 · 37.5/s | 4.1%, checks 96.5% | 5 ms / 2.5 s / 8.7 s | 708 ms · 1.6 s · 406 ms | **10.0 s** | 16/43 (report-only) |
| soak, 30 users × 10 min | 7,740 · 11.2/s | 0 | 4 / 59 / 603 ms | 5 · 9 · 511 ms | 245 ms | 35/42: writes; drift 46 → 61 ms (1.31×, under the floor) |

**The laptop's write latency is the disk, not the app.** Reads are 10 ms on both machines
and the write budget holds with 3 ms to spare on the runner, so the 775 ms is environmental.
Docker Desktop's WSL data disk (`docker_data.vhdx`) lives on the laptop's HDD, Postgres runs
with `synchronous_commit = on`, so every commit waits for a WAL fsync on a spinning disk:
a single-client sequential insert into any table takes ~40 ms at the median and stalls for
0.7–1.4 s whenever the checkpointer is flushing (the stack's checkpoint stats showed ~290 s
of checkpoint write time; there are no triggers on these tables). Proof by A/B, two
identical 10-user soaks on the laptop: with `synchronous_commit = off` (commits no longer
wait for the disk) write p50 / p95 / p99 went from 37 / 119 / 142 ms to 3 / 6 / 13 ms,
reads unchanged; the setting was put back afterwards. The budget stays as it is: the
runner's numbers are the reference, and a local run on this disk is read for its reads,
its error rate and its shape.

**Where it broke.** Stepping to 300 users with realistic think time (63 requests/s) did not
find a knee on the laptop: reads stayed at 32 ms, no server returned an error, and the 400
sign-ins per 5 minutes were the only thing that queued (bcrypt, CPU-bound, 402 ms p95).
The spike did: 250 users signing in within ten seconds saturate the CPU in GoTrue's
password hashing, sign-ins take 10 s at p95, every request behind them queues (reads 1.6 s,
search 708 ms, `/api/trainer` 7.2 s to first byte because its middleware verifies the token
with the same GoTrue), and 4% of requests fail. Within a minute of the spike ending the
last third of the run is back to a 56 ms p95: the stack recovers, it does not stay down.
Nothing in the app's queries was the limit; the password check is. The one stress failure
was k6 closing a request it had in flight at ramp-down (Kong logged a 499), not a server error.

**To find the knee by hand:** `THINK_SCALE=0.2 VUS=300 make perf-stress` turns the same
journeys into ~5× the request rate; or raise `VUS` towards the 400 cap.

## Honest limitations

- k6 and the stack share one machine, so at high VU counts k6's own CPU use is part of
  what is measured, and a laptop's numbers are not a server's. Compare runs on the same
  machine; the dashboard's trend is more useful than any single value.
- The local stack is not production: PostgREST here has a small connection pool and no
  pooler in front of it, and hosted Supabase sits behind a CDN and a load balancer. What
  transfers is the *relative* cost of queries and the shape of the breakdown, not the
  absolute throughput ceiling.
- Think time makes 30 virtual users a modest request rate (tens per second). That is the
  point of a journey mix; the stress and spike scenarios are where request rates climb.
- `setup()` seeds everything through the REST API as the service role; 60 users × 90 days
  takes about a minute. The seed uses `Math.random()`, so runs are statistically but not
  byte-for-byte identical.
- k6 buffers a streamed response, so the trainer journey measures time-to-first-byte
  (`http_req_waiting`), not the stream.
