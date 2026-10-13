# FitLog API, database and security tests

A Python test suite for FitLog's backend: the Supabase database API (PostgREST),
Auth (GoTrue), Storage, the Postgres row-level security policies themselves, and
the Cloudflare Pages Functions that call Claude. It runs only against a
disposable local Supabase stack in Docker, never a hosted project.

**646 tests** (628 pytest + 18 pytest-bdd scenarios), about a minute locally on
all cores, no retries. Lint (ruff), types (mypy `--strict`), JUnit XML and an
Allure report come with every CI run.

## What it covers

| Area | Folder | Tests | What it proves |
|---|---|--:|---|
| Authentication | `tests/auth` | 59 | Sign-up, sign-in, refresh-token reuse, sign-out; 9 kinds of forged or tampered token (expired, wrong key, edited `sub`/`role`/`aud`/`exp`, stripped signature, `alg: none`, garbage) refused on all four API surfaces, each against a control that a valid token works |
| Authorization and data isolation | `tests/authz` | 291 | For **every** per-user table: another user can't read, change, delete, forge or take over (upsert) your rows; signed-out visitors get nothing. Tested through the API **and** in Postgres directly (acting as `authenticated` with JWT claims), so the policies themselves are exercised. Plus storage isolation, privilege escalation (auth admin API, hidden schemas, RPCs, bucket settings, DDL) and catalog guards |
| API contracts | `tests/contracts` | 81 | Create/read/update/delete on every table, each response validated against a strict pydantic model; the domain rules behind deletes, snapshots and defaults |
| Validation and constraints | `tests/validation` | 103 | Required columns, wrong types, CHECK ranges at both boundaries, per-user uniqueness, links to missing or **another user's** rows, oversized input |
| Sensitive data | `tests/security` | 31 | 14 different refusals scanned for secrets, tokens, stack traces, file paths, connection strings and other users' data; exports hold only your own rows; the trainer never returns its prompt or key |
| Pages Functions | `tests/functions` | 63 | What `/api/trainer` and `/api/scan-plate` send to Claude (key, model, budget, system prompt with the user's log and memory, input caps) and how they handle every kind of upstream failure; who may call each function; the recipe importer's URL guard |
| Scenarios (BDD) | `tests/bdd` | 18 | The isolation guarantees and four everyday journeys as Gherkin feature files |

What it found and how each problem was fixed: [`SECURITY-FINDINGS.md`](../SECURITY-FINDINGS.md).

### Why these checks live below the UI

The Playwright suite proves the screens work. It can't cheaply prove that
*nobody else* can reach your data, because the UI never even tries: it only
ever asks for the signed-in user's own rows. An attacker doesn't use the UI.
They call the API directly with edited tokens, other people's ids and
malformed bodies. So those checks belong at the layer the attacker talks to,
and in the database policies underneath it.

This is the middle of the test pyramid. Vitest covers the pure logic in
milliseconds; this suite covers every table, token and failure mode in about a
minute; Playwright covers a few dozen end-to-end journeys in a few minutes. A
missing RLS policy fails here in seconds, with the table name in the test id,
instead of surfacing as a confusing E2E failure, or not at all.

## Run it

You need Docker, Node 22+ (`npm ci` once at the repo root) and Python 3.12+.

```bash
# once: the suite's own environment
python3 -m venv api-tests/.venv
api-tests/.venv/bin/pip install -r api-tests/requirements.txt

make stack-up     # the local Supabase stack (same one the E2E suite uses)
make test-api     # starts the functions server + Claude stub, runs everything
make report       # builds and opens the Allure report
make stack-down
```

No `make` (e.g. Git Bash on Windows)? Every target is also
`bash scripts/test-all.sh <target>`. Extra arguments go to pytest:
`bash scripts/test-all.sh test-api -k trainer`.

Without the helper, by hand:

```bash
source api-tests/scripts/local-env.sh                     # URLs + local keys from `supabase status`
bash api-tests/scripts/start-functions.sh --bg            # prints two variables to export
cd api-tests && pytest -n auto --dist loadgroup
```

`--dist loadgroup` keeps the tests that share the Claude stub on one worker;
everything else spreads across all cores. Without the functions server running,
the functions tests are skipped locally (with the reason) and **fail** in CI.

### Safety rails

- The testkit's `config.py` refuses any URL that isn't local, so a copied `.env` can't
  point the suite at dev or production.
- The service-role key is used only by fixtures, to create and delete users. No
  request under test is ever sent with it.
- Every user is created for this run (`<label>-<run id><worker>-<n>@api.test`)
  and deleted at the end, which cascades to their rows. Database-level tests run
  inside a transaction that is always rolled back.
- Nothing secret is committed: every key is read from the running stack.

## How it's organised

```
api-tests/
├── tests/               # one folder per area (table above)
│   └── bdd/features/    # Gherkin
└── scripts/
    ├── local-env.sh     # exports the local stack's settings
    └── start-functions.sh  # wrangler pages dev + the stub
```

The clients, test users, data builders, contracts and Claude stub the tests are
written with are the shared [testkit](../testkit/README.md), an installable
package (`fitlog-testkit`) that `requirements.txt` installs in editable mode.
The AI evals use the same package. Its README has a five-minute guide to
starting a new suite on it.

## Adding a table to the isolation tests

One line. Add a `TableSpec` to the testkit's `tables.py` (`testkit/src/testkit/tables.py`):

```python
TableSpec("water_logs", m.WaterLog, lambda c: {"logged_on": DAY, "ml": 250}, ("ml", 500)),
#          table name    contract    a valid row (c.token is unique)          column to edit in update probes
```

and its response contract to `models.py` next to it. The table is then covered by
every RLS test (API and database), the CRUD contract tests and the export test.
You don't have to remember: `test_every_public_table_is_covered_by_the_isolation_suite`
fails as soon as the table exists without a spec. Other catalog guards fail if it
has no RLS or no owner-only policy, if a new foreign key between user tables
doesn't include `user_id`, or if a new text column has no size limit.

For a table whose rows hang off another (like `workout_sets` → `workouts`),
name the parent: `TableSpec(..., parents={"workout": "workouts"})`. The factory
creates the parent first, as the same user, and passes its id in `c.parents`.

## Writing BDD scenarios

Feature files live in `tests/bdd/features/`; the steps (`tests/bdd/conftest.py`)
are small and shared, so most new scenarios need no new code:

```gherkin
Scenario Outline: Another user can't read, change or delete your <records>
  Given Alice has <records> saved
  When Bob tries to read Alice's <records>
  Then Bob finds nothing
```

Each scenario signs up fresh users, so it reads exactly like the data it runs on.
The exhaustive per-table matrix stays in `tests/authz`; the features are the
same guarantees told as stories a product owner can read.

## The Claude stub

`/api/trainer` and `/api/scan-plate` call Claude. Locally they're pointed at
the testkit's `anthropic_stub.py` through `ANTHROPIC_BASE_URL` (unset in production).
The stub records every request and plays back whatever a test queues:

```python
claude.queue(Reply.error(429, "rate_limit_error", "Slow down"))
resp = trainer.ask_trainer("How do I add 20 lb to my bench?")
assert resp.status_code == 502
assert FunctionError.model_validate_json(resp.content)    # one message, nothing else
sent = ClaudeRequest.model_validate(claude.only_call().body)  # what went upstream
```

Replies: `stream`, `message`, `error`, `hang` (timeouts), `drop` (dead
connection), `stream_error` (fails mid-answer), `refusal` and `raw` (anything,
for malformed responses).

## Reports

- **JUnit XML**: `reports/api-junit.xml`. CI feeds it to the quality dashboard
  (`metrics/adapters/junit.mjs`), next to the unit and E2E suites.
- **Allure**: `reports/allure-results`, grouped by area. `make report` builds and
  opens it (needs Java); in CI it's the `allure-report` artifact on every run.

## CI

The `api` job in `.github/workflows/ci.yml` runs on every push and pull request,
in parallel with the E2E job, against its own local stack: lint, type-check,
start the functions server and stub, run the suite, publish JUnit + Allure. It is
part of the release gate: `deploy-prod` needs it to pass.
