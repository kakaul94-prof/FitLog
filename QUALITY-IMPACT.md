# Quality impact

What the test work on FitLog changed, in numbers taken from this repository and
its CI history. **Before** is the first in-repo CI run (2026-10-05,
[run 37357409162](https://github.com/kakaul94-prof/FitLog/actions/runs/37357409162)).
**Now** is `dev` at `d5bf2a4` plus this branch, measured on 2026-10-13. Every
number is measured or counted; none is estimated. Where a number rests on a
small sample or a single run, it says so. How to re-check each one is at the end.

## At a glance

| | Before (2026-10-05) | Now (2026-10-13) |
|---|---|---|
| Tests run on every PR | **485** in 2 layers | **1,576** in 5 layers (3.2×) |
| CI feedback time (successful run, wall clock) | 2 min 16 s (median, first 6 runs) | 4 min 18 s (latest `dev` run) |
| Defects found by the tests and fixed | n/a | **24** in what ships, plus 9 in the tests themselves |
| Flaky E2E results (CI pushes) | 0.95% on 2026-10-08, all one test | 0 in every run since its root cause was fixed (3 runs) |
| Vulnerable packages in shipped dependencies (`npm audit --omit=dev`) | 3 (1 critical, 1 high, 1 moderate) | **0** |
| Secrets in git history | 0 | 0 |

## 1. Tests per layer

| Layer | Tool | Before | Now | Covers |
|---|---|---|---|---|
| Unit | Vitest | 475 | **537** | Pure logic: calorie and macro math, nutrients, progression, dates, import/export, the trainer chip parser |
| API, database, security | pytest + pytest-bdd | 0 | **646** | Row-level security on every table (authz 291), validation 103, contracts 81, Pages Functions 63, auth 59, security 31, BDD 18 |
| Shared testkit's own tests | pytest | 0 | **103** | The clients, guards and Claude stub the Python suites are built on (this branch) |
| AI evals, tier 1 | pytest, Claude stubbed | 0 | **183** | The trainer chat's guardrails: injection, exposure, unintended actions, failures |
| AI evals, live tier | pytest, real Claude | 0 | 58 cases × 3 runs | Manual (`workflow_dispatch`), capped; not part of the 1,576 |
| End-to-end | Playwright in Docker | 10 | **107** | 95 browser journeys + 4 API-level RLS checks + 8 sign-in setups |

Before in-repo CI, end-to-end tests lived in a separate repository
(`kakaul94-prof/fitlog-e2e`) and ran against the deployed dev site after each
deploy and on a schedule: see section 3.

## 2. Run time per layer

| Layer | CI job, latest `dev` run (ubuntu, incl. setup) | Local, one run (Windows laptop, 2026-10-13) |
|---|---|---|
| Unit | 28 s | 9–12 s (Vitest); the tests themselves under 2 s |
| Testkit | step in the API job (new) | 9–13 s |
| API, database, security | 2 min 31 s | 51–65 s (`-n auto`); about 2 min with the functions server start |
| AI evals, tier 1 | 2 min 29 s | 61–65 s |
| End-to-end | 4 min 00 s | 3.0–3.3 min (retries off) |
| Security scans (report only) | 2 min 39 s | not timed |

The CI jobs run in parallel, so the end-to-end job is the critical path.

## 3. CI feedback time

**Before in-repo CI** (separate E2E repo, 2026-07-21 to 2026-09-24): 307 runs,
median **25 min** per run (green runs: 9 min), and it reported only *after*
the code was deployed to dev. It also stopped being usable as a signal: from
2026-08-01, all 213 completed runs were red. Of 280 completed runs, 35 passed,
all in July.

**In-repo CI** (every PR and every push to `dev` and `main`, blocking the
production deploy):

| Period | Jobs | Successful runs | Run, median | Unit | E2E | API |
|---|---|---|---|---|---|---|
| 2026-10-05 to 10-07 | unit, E2E | 6 | 2 min 16 s | 35 s | 2 min 9 s | |
| 2026-10-08 to 10-11 | + metrics, E2E grows to 43–76 tests | 12 | 3 min 9 s | 35 s | 2 min 51 s | |
| 2026-10-12 to 10-13 | + API, security | 6 | 3 min 5 s | 38 s | 2 min 48 s | 1 min 55 s |
| 2026-10-13, latest `dev` | + AI evals tier 1 | 1 | 4 min 18 s | 28 s | 4 min 0 s | 2 min 31 s |

Feedback time roughly doubled while the tests per run more than tripled, and
it now arrives before the merge instead of 25 minutes after the deploy. 13 of
the first 37 CI runs (to 2026-10-13 01:15 UTC) failed; 5 of them were `dev`
pushes that broke E2E on 2026-10-11, fixed on 2026-10-12 (PR #8).

## 4. Defects found and fixed, by category

Categories are this report's grouping; each ID links to a write-up in
[SECURITY-FINDINGS.md](SECURITY-FINDINGS.md) or
[AI-SAFETY-FINDINGS.md](AI-SAFETY-FINDINGS.md), or to the PR that fixed it.

| Category | Fixed | Highest severity | Found by | IDs |
|---|---|---|---|---|
| Access control | 2 | High | API suite | F-01, F-02 |
| Vulnerable shipped dependencies | 2 | High (critical upstream) | Security scans | F-10, F-11 |
| AI safety: prompt injection, unintended actions | 3 | High | AI evals | AI-01, AI-02, AI-10 |
| AI answer quality and safe advice | 5 | Medium | AI evals (live) | AI-04, AI-05, AI-06, AI-08, AI-09 |
| Functional bugs | 4 | Medium | API suite, AI evals, E2E | F-08, F-09, AI-03, stale diary after a reload (PR #8) |
| Information exposure | 2 | Low | API suite, AI evals | F-04, AI-07 |
| Input validation and SSRF guard | 2 | Low | API suite | F-05, F-06 |
| Cost and availability | 2 | Medium | API suite | F-03, F-07 |
| Missing security headers (3) | 1 | Low | ZAP | S-04 |
| Accessibility: unlabelled form inputs | 1 | Low | E2E | PR #6 |
| **Total in what ships** | **24** | | | |

Also fixed: 3 high advisories in test tooling (`wrangler`, `miniflare`,
`undici`), and 9 defects in the tests themselves: three E2E races (PR #6) and
six mistakes in the AI evals (E-01 to E-06). AI-06 still shows in 1 of 3 live
runs. Recorded as accepted risks rather than fixed: A-01 to A-05 and I-01 to
I-02. Still open: a full Content-Security-Policy (S-04) and 12 advisories in
build and test tooling (S-03).

## 5. Flaky-rate trend

From the quality dashboard's history (`gh-pages:data/history.json`), which
records every push to `dev` and `main` (19 runs, 2026-10-07 to 10-13). CI
retries a failing E2E test up to twice; "flaky" means it passed on a retry.

| Date | Runs | E2E results | Flaky | Rate |
|---|---|---|---|---|
| 2026-10-07 | 1 | 10 | 0 | 0% |
| 2026-10-08 | 10 | 529 | 5 | 0.95% |
| 2026-10-11 | 5 | 215 | 1 | 0.47% (plus 14 real failures) |
| 2026-10-12 | 2 | 86 | 0 | 0% |
| 2026-10-13 | 1 | 107 | 0 | 0% |

All 6 flaky results were one test, `cardio.spec.ts:106`, and its flakiness was
an app bug: a cached diary restored after a reload counted as fresh and wasn't
refetched. Reproduced locally in 4 of 10 runs; 10 of 10 passed after the fix
(`3f2549d`, PR #8). The 3 recorded runs since then have no flaky results, a
small sample. Unit and API results have never been flaky (0 in 19 and 2
recorded runs). Over all 11,732 recorded results: 6 flaky (0.05%). The manual
flake-hunt workflow has never been run.

One local run in this work timed out 4 sign-in setups while a freshly started
container compiled the app; the re-run passed 107 of 107 with retries off.
Local runs aren't in the dashboard data.

## 6. Security scans

| Scan | 2026-10-12, before the fixes | `dev` CI, 2026-10-13 | This branch, 2026-10-13 |
|---|---|---|---|
| Secrets (gitleaks, every branch) | 0 in 334 commits | 1 in 384 commits: a false positive (jwt.io's example token in an AI-eval test) | **0 in 391 commits** (test fixtures allowlisted) |
| Node dependencies (npm audit) | 15: 2 critical, 9 high, 4 moderate | 15: same | **12: 1 critical, 8 high, 3 moderate, all build and test tooling; 0 in what ships** |
| Python dependencies (pip-audit) | 0 in 61 packages | 0 in 59 packages | 0 (the local testkit isn't on PyPI, so it's skipped) |
| Running app (OWASP ZAP baseline) | 0 high, 5 medium, 1 low, 3 informational | same | not re-run locally (no header change); CI runs it on the PR |

## Re-checking these numbers

- CI runs and job times: `gh run list --workflow CI --json ...` and `gh run view <id> --json jobs`.
- The external E2E repository: `gh run list -R kakaul94-prof/fitlog-e2e --limit 1000`.
- Flaky history: `git show origin/gh-pages:data/history.json`.
- Test counts: `npx vitest run`; `pytest --collect-only -q` in `api-tests/`, `ai-evals/` and `testkit/`; `npx playwright test --list`.
- Scans: `make test-security`, or the "Security scans" job's summary on any run.
