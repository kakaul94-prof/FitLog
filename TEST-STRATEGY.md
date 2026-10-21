# FitLog test strategy

FitLog is a phone-first food, cardio and strength tracker (React + Supabase) with an AI trainer chat, used in production by one person. This is how it is tested: the risks, the layer that catches each, the release gates, and the gaps. Counts are from `dev` on 2026-10-21.

**At a glance**

- **1,674 tests gate every deploy**: 598 unit, 680 API and database, 264 AI guardrail, 132 end-to-end, in four parallel CI jobs on every pull request and push.
- **Production deploys only from `main` after all four pass.** k6 smoke, security scans and quality metrics run alongside without blocking.
- **My own database is never stubbed**: a throwaway Supabase stack in Docker per CI run, built from the production schema and RLS policies. Third-party and AI services always are.
- **Flakiness is measured, not retried away**: 6 flaky E2E results in 3,009 over 35 pushes, all one app bug, none since its fix; 0 in 34,354 unit, API and AI results.
- **Biggest gaps**: the production canary is built but not live, and the phone's native features (camera, GPS, Bluetooth) are tested by hand only.

## 1. Goals and risks

What a user would lose, in order of how much it would hurt:

- **Lost or duplicated entries** (double tap, lost reply, offline replay): a wrong day's log, a broken streak.
- **Wrong macros or calories** (per-100 g data scaled wrongly, a unit slip): the number the user eats by is silently wrong.
- **Offline data loss or a half-applied restore**: months of history gone or mixed.
- **Unsafe AI trainer output** (hostile text in logged data, a crash diet entertained, a leaked key): physical harm, or a secret in a chat bubble.
- **Leaked data between users** (a missing RLS policy, a foreign key into another user's rows): a privacy breach.
- **A failing backend, a vulnerable dependency, a secret in git**: a tap that fails; an account taken over.

Goals: none of these reaches production; a failure names the risk and the screen or table; the gate runs in minutes on every PR.

## 2. Which layer catches which risk

| Risk | Layer | Why this layer | Count |
|---|---|---|---|
| Wrong macros, calories, 1RM, dates | **Unit**: Vitest, [`src/lib/*.test.ts`](src/lib) | Pure functions: every boundary value in milliseconds | 598 |
| Another user's data readable, writable or linkable | **API / database**: [`api-tests/`](api-tests/README.md), pytest | Attackers call the API with forged tokens, not the UI; policies tested through PostgREST and in Postgres | 680 (291 authorization) |
| Rows that break the data model | **Contract tests**: [`contracts`](api-tests/tests/contracts), [`validation`](api-tests/tests/validation) | Every table's CRUD response checked against a strict pydantic model; CHECK ranges at both edges | 81 + 103 |
| Lost, duplicated or half-applied writes | **Resilience**: [`tests/resilience`](api-tests/tests/resilience) + E2E (§4) | Idempotency is a database property; what the user sees after a lost reply is a UI one | 34 + 30 |
| A screen that doesn't work on a phone | **Playwright E2E**: [`e2e/`](e2e/README.md), Docker, Pixel 7 | The only layer driving the real UI; each journey also polls Postgres, so a nice screen with nothing saved fails | 132 (119 journeys, 4 RLS, 9 sign-ins) |
| Unsafe, leaky or wrong trainer answers | **AI evals**: [`ai-evals/`](ai-evals/README.md), tier 1 stubbed, tier 2 live | Guardrails are deterministic and gate releases; model behaviour needs the real model and a judged rubric | 264; 87 cases × 3 live |
| Trainer unusable when Claude fails | **AI evals tier 1**: [`test_dependency_failures.py`](ai-evals/tests/test_dependency_failures.py) | 18 simulated upstream failures (429, 529, bad key, cut stream, stall, token limit…) | 78 |
| Slow under load, drifting over an hour | **k6**: [`perf-tests/`](perf-tests/README.md) | Replays the app's own request mix on users seeded with 90 days of history; a budget per endpoint group | 5 scenarios |
| Secrets, vulnerable dependencies, missing headers | **Security scans**: [`security-scan.sh`](scripts/security-scan.sh) | gitleaks, npm audit, pip-audit, OWASP ZAP; report-only, tracked in [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) | 4 scans per PR |
| Production answering worse after a deploy | **Canary**: [`prod-canary.yml`](.github/workflows/prod-canary.yml) | Shift-right: 10 eval cases through the deployed trainer every 6 h | built, not live (§6) |

Every CI run executes the 1,674 tests of the four gating layers (unit, API, AI tier 1, E2E) plus 105 self-tests of the shared [`testkit/`](testkit/README.md).

## 3. Verification and validation

**Built right.** The build type-checks the app before any test runs; the Python suites pass `ruff` and `mypy --strict`. 18 Gherkin scenarios ([`bdd/features`](api-tests/tests/bdd/features)) are the executable spec for data isolation and four everyday journeys; 81 contract tests pin every table's API shape, so a breaking schema change fails in seconds, naming the table. The testkit has 105 tests of its own; changes merge through pull requests with CI attached.

**The right thing.** 119 phone-viewport journeys do what a user does, from logging a meal to restoring a backup and asking the trainer. The live AI tier asks the real model 87 questions from synthetic users' logs and judges each against a rubric written from the user's goal; the judge was calibrated against my own blind labels (93% agreement, kappa 0.81, [`ai-evals/calibration`](ai-evals/calibration)), and a disagreement revises the rubric, never the labels. 8 counterfactual groups and 5 dietary constraints must get equivalent advice.

## 4. Edge cases and failure modes

The rule: **a bug gets a failing test before it gets a fix**, as two commits, so the test is proven to catch it. [PR #12](https://github.com/kakaul94-prof/FitLog/pull/12) did this for six write bugs; [SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) and [AI-SAFETY-FINDINGS.md](AI-SAFETY-FINDINGS.md) name the guarding test for each of their findings. Faults are injected by request interception, never timing.

- **Offline sync** ([`offline-sync.spec.ts`](e2e/tests/offline-sync.spec.ts)): offline entries, weigh-ins and cardio reach the server once, in order, after a restart too; add-then-delete stays deleted.
- **Lost replies and retries** ([`duplicate-writes.spec.ts`](e2e/tests/duplicate-writes.spec.ts)): a reply dropped after the server committed, a refused request, a request held back to force the worst order; a double tap saves once.
- **Duplicate writes** ([`test_idempotent_writes.py`](api-tests/tests/resilience/test_idempotent_writes.py)): every table refuses a second insert with the same app-made id; batch inserts are all-or-nothing.
- **All-or-nothing restore** ([`test_restore_backup.py`](api-tests/tests/resilience/test_restore_backup.py), [`backup.spec.ts`](e2e/tests/backup.spec.ts)): one Postgres transaction; a bad row or a dropped connection changes nothing.
- **Stale cache** ([`consistency.spec.ts`](e2e/tests/consistency.spec.ts)): a cached day is replaced by the server's version after a restart; two-device same-field edits are last-save-wins, pinned rather than hidden.
- **18 simulated Claude failures**: rate limits, 5xx, bad key, no credit, dropped or cut streams, HTML error pages, garbled output, mid-answer stalls, the token limit; each must fail safely and leak nothing.

## 5. Mocking and test data

**Stubbed, always: third-party and AI services.** USDA is a Playwright route fixture ([`support/usda.ts`](e2e/support/usda.ts)) and an unstubbed request fails the test; the trainer endpoint is scripted and recorded ([`support/trainer.ts`](e2e/support/trainer.ts)); Claude is a recording stub ([`anthropic_stub.py`](testkit/src/testkit/anthropic_stub.py)) for the API suite, tier 1 and k6, so tests assert what the app *sends*. GPS and the clock are faked.

**Never stubbed: my own database.** Every CI job starts a throwaway Supabase stack in Docker from the production [`schema.sql`](supabase/schema.sql) and RLS policies, seeded with ten accounts; a stubbed database would pass tests a real policy fails. [`env.ts`](e2e/support/env.ts) and the testkit refuse any non-local URL.

**Run-unique data.** E2E rows carry a run id in their names ([`support/data.ts`](e2e/support/data.ts)) and each area owns a seeded account, so specs run in parallel and rerun without a reset; API and k6 users are created per run and deleted afterwards.

## 6. Release gates

- **Deploy to production** ([`ci.yml`](.github/workflows/ci.yml)) runs only on a push to `main` where all four test jobs passed; the same four run on every PR and `dev` push. Branch protection is off: the deploy is gated, the merge is not.
- **Fails the PR, not the deploy:** the k6 smoke (2 users, 1 minute, zero errors). **Report-only:** security scans, quality metrics.
- **Nightly** ([`perf.yml`](.github/workflows/perf.yml)): k6 load (30 users, 5 min) and a 10-minute soak with drift check; 3 runs, all within budget.
- **By hand, spend-capped (~$0.80):** the live AI tier before a prompt change ships; the 2026-10-13 run met every bar on 58 cases.
- **Flake rate is tracked, not hidden.** A retried E2E test is recorded as *flaky*, never as passed, on the [quality dashboard](https://kakaul94-prof.github.io/FitLog/) ([`metrics/`](metrics)); unit, API and AI tests get no retries. The one flaky test was an app bug, fixed in PR #8; the 29 real E2E failures were all on `dev`. A manual [flake hunt](.github/workflows/flake-hunt.yml) workflow exists.
- **Production canary: built, not live.** Every 6 hours [`prod-canary.yml`](.github/workflows/prod-canary.yml) is meant to send 10 eval cases through the deployed trainer and open or close a GitHub issue per failure kind; runner, alerts and cost cap are tested against fakes ([`test_canary.py`](ai-evals/tests/test_canary.py), [`test_alerts.py`](ai-evals/tests/test_alerts.py)). **Every scheduled run so far has stopped at the secrets check**: the monitor account and its two secrets are not set up, so no canary has run against production.

## 7. Reviewing AI-generated tests

An agent's tests are untrusted contributions: the same review as mine, plus rules for the agent failure mode, a test that passes for the wrong reason.

1. **Quarantine first**: agent output lives in an opt-in Playwright project CI never runs, until a person has read every line.
2. **Green is not correct**: for each assertion, ask what would have to be wrong for it to fail.
3. **The oracle is stored state**, read over REST, not a page reload (the cache repaints from IndexedDB).
4. **Anchored locators and page objects**; a known bug is pinned with `test.fail()`, never absorbed by a loose regex.
5. **Measure reliability with retries off** (5 runs, parallel workers), and watch for assertions weakened to match current behaviour.

Findings, on the separate [fitlog-e2e](https://github.com/kakaul94-prof/fitlog-e2e) suite ([PR #1](https://github.com/kakaul94-prof/fitlog-e2e/pull/1); README, "AI test agents"), where Playwright's planner, generator and healer ran headless with Claude Code on the Rehab area:

- The generator's **5 specs passed 25 of 25 runs as written; review still found 9 defects**: a reload-based persistence check, five files racing on one jsonb column, a `ran \d+ days` regex that accepted the app's "ran 1 days" bug, colliding locators. All 5 were kept, reworked, and pass 25/25 with retries off. The planner surfaced **4 real app issues**, fixed in [FitLog #21](https://github.com/kakaul94-prof/FitLog/pull/21).
- The **healer**, benchmarked against 2 fixes from git history, **matched 1 of 2 exactly** (the helpers it needed already existed). The other it refused without context, then fixed with one sentence of product intent but a weaker wait: 28/30 passes against 30/30 for the hand fix. It weakened no assertion.

## 8. What's next

- **The canary is not live**: it needs a production monitor account and two secrets.
- **AI evals**: three fairness fixes await a live re-run; one finding may be variance; AI-06 still shows in 1 of 3 runs.
- **Native features are tested by hand only** (rest timer, Health Connect, biometric lock, Bluetooth strap, camera); CI compiles the Android app but runs nothing on a device.
- **Offline is only partly retry-safe**: diary, weigh-ins and cardio survive a restart; other offline writes drop if the app closes first.
- **Security and load**: no full Content-Security-Policy; 12 advisories, all in build and test tooling; the 30-user load target is a plan, not a measurement.
- **Coverage**: the fitlog-e2e cross-browser suite is auto-disabled for inactivity (repair open in [fitlog-e2e #2](https://github.com/kakaul94-prof/fitlog-e2e/pull/2)); no visual regression or accessibility checks here.
- **Docs lag the code**: the api-tests and ai-evals READMEs say 646 tests and 17 failure modes (680 and 18 today); QUALITY-IMPACT.md is a 2026-10-13 snapshot.

**Re-checking the numbers:** `npx vitest run` · `npx playwright test --list` · `pytest --collect-only -q` in `api-tests/`, `ai-evals/`, `testkit/` · `git show origin/gh-pages:data/history.json` · `gh run list --workflow prod-canary.yml`.
