# fitlog-testkit

The shared Python toolkit FitLog's backend test suites are written with:
clients for Supabase Auth, the database API (PostgREST), Storage and the Pages
Functions; per-run test users that clean up after themselves; a registry of
every per-user table and a factory that builds valid rows for any of them;
strict response contracts; hand-made bad tokens; a leak scanner; and a
recording stand-in for the Claude API.

It asserts nothing itself. The suites decide what to check:

| Suite | What it tests with the testkit |
|---|---|
| [`api-tests/`](../api-tests/README.md) | Auth, row-level security, contracts, validation, security, the Pages Functions (646 tests) |
| `ai-evals/` | The Ask-a-trainer chat's safety and quality, against the Claude stub or the real API |

Typed throughout (`py.typed` ships, mypy `--strict` clean), so a suite that
uses it is type-checked against it with no extra configuration.

## Start a new suite in five minutes

A new suite (a load test, a migration check, a new feature's API tests) needs
four files. Everything below runs from the repository root.

**1. Its environment.** `my-suite/requirements.txt`:

```text
# Install from the repository root (the editable path is relative to it)
-e ./testkit
pytest==9.1.1
```

```bash
python3 -m venv my-suite/.venv
my-suite/.venv/bin/pip install -r my-suite/requirements.txt   # Windows: .venv/Scripts/pip
```

`-e` (editable) means a change to the testkit is picked up at once, with no
reinstall.

**2. Fixtures.** `my-suite/tests/conftest.py`:

```python
from collections.abc import Iterator
from uuid import uuid4

import httpx
import pytest

from testkit import AdminAuth, AuthClient, RestClient, Settings, UserFactory


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env()  # refuses anything but the local stack


@pytest.fixture(scope="session")
def http() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=10) as client:
        yield client


@pytest.fixture(scope="session")
def users(settings: Settings, http: httpx.Client) -> Iterator[UserFactory]:
    factory = UserFactory(
        AdminAuth(http, settings.supabase_url, settings.service_role_key),
        AuthClient(http, settings.supabase_url, settings.anon_key),
        run_id=uuid4().hex[:8],
    )
    yield factory
    factory.delete_all()  # every user this run made, and with them all their rows


@pytest.fixture
def api(settings: Settings, http: httpx.Client) -> RestClient:
    return RestClient(http, settings.supabase_url, settings.anon_key)  # signed out
```

**3. A test.** `my-suite/tests/test_weigh_ins.py`:

```python
from testkit import TABLES_BY_NAME, RestClient, UserFactory, create_row


def test_nobody_else_can_read_your_weigh_ins(users: UserFactory, api: RestClient) -> None:
    alice, bob = users.create("alice"), users.create("bob")
    weigh_in = create_row(api.as_user(alice.access_token), TABLES_BY_NAME["measurements"])

    resp = api.as_user(bob.access_token).select("measurements", {"id": weigh_in["id"]})

    assert resp.status_code == 200
    assert resp.json() == []  # row-level security hides it rather than refusing
```

`create_row` builds a valid row for any table in the registry, creating its
parent rows first as the same user, so a test never hand-writes a workout to
get a set.

**4. Run it** against the local Supabase stack (Docker):

```bash
npm run db:start                        # once; `npm run db:stop` when done
source api-tests/scripts/local-env.sh   # exports the stack's URLs and local keys
cd my-suite && .venv/bin/pytest
```

That's a working suite. Nothing is left behind: each user is deleted at the
end, which cascades to their rows.

### Testing a Pages Function

The functions run under `wrangler pages dev` with the Claude API swapped for
the recording stub:

```bash
bash api-tests/scripts/start-functions.sh --bg   # prints two variables; export them
```

```python
import httpx

from testkit import FunctionsClient, Settings, UserFactory
from testkit.anthropic_stub import AnthropicStub, Reply


def test_the_trainer_streams_claudes_answer(
    settings: Settings, http: httpx.Client, users: UserFactory
) -> None:
    assert settings.functions_url and settings.stub_url, "start the functions server first"
    claude = AnthropicStub(http, settings.stub_url)
    claude.reset()
    claude.queue(Reply.stream("Drive through your heels."))
    alice = users.create("alice")

    trainer = FunctionsClient(http, settings.functions_url, alice.access_token)
    resp = trainer.ask_trainer("Squat tips?")

    assert resp.status_code == 200
    assert "Drive through your heels." in resp.text
    assert claude.only_call().body["messages"][-1]["content"] == "Squat tips?"
```

The stub records what each function sent upstream and plays back whatever the
test queued: a normal or failed stream, an API error, a hang, a dropped
connection, a refusal or any raw body.

## What's in it

Everything below imports from `testkit` directly (it's in `__all__`), except
the contracts and the stub, which import from their modules.

| Module | Public names | For |
|---|---|---|
| `config` | `Settings`, `ConfigError`, `FAKE_ANTHROPIC_KEY` | Reads the stack's URLs and keys from the environment; refuses any non-local URL |
| `auth` | `AuthClient`, `AdminAuth`, `SignedInUser` | Sign-up, sign-in, refresh, sign-out; service-role user admin (fixtures only) |
| `rest` | `RestClient`, `ApiError`, `Row` | PostgREST: `select`, `insert` (with upsert), `update`, `delete`, `rpc`; `create`/`rows` for setup |
| `storage` | `StorageClient`, `effective_status` | Storage objects and buckets; reads the real status out of Storage's 400s |
| `functions` | `FunctionsClient`, `Turn` | `POST /api/<name>`; `ask_trainer` sends a chat the way the app does |
| `users` | `UserFactory` | Per-run users, deleted newest first at the end |
| `tables` | `TABLES`, `TABLES_BY_NAME`, `INSERTABLE`, `TableSpec`, `RowContext` | The registry of per-user tables: one line per table |
| `factories` | `build_row`, `create_row`, `db_create_row`, `db_insert`, `new_token` | A valid row for any table, through the API or straight into Postgres |
| `db` | `connect`, `acting_as`, `create_auth_user` | Act as a user (or anonymous) inside a transaction, to test RLS policies directly |
| `tokens` | `make_token`, `with_claims`, `unsigned`, `without_signature`, `claims_of`, `FORGED_TOKENS` | Expired, forged, tampered and unsigned JWTs |
| `leaks` | `find_leaks` | Finds secrets, tokens, stack traces, internal addresses or another user's data in a response |
| `models` | `Contract`, one model per table, `ClaudeRequest`, `FunctionError`, `PostgrestError`, `parse_rows`, `parse_error` | Strict pydantic contracts: an extra field or a wrong type fails |
| `anthropic_stub` | `AnthropicStub`, `Reply`, `RecordedCall`, `serve` | The recording Claude stand-in; `python -m testkit.anthropic_stub --port 8790` runs it |

Every client method returns the raw `httpx.Response`, because the status and
the error body are usually what a test is checking.

## Safety rails

- `Settings.from_env()` refuses any URL that isn't local, so a copied `.env`
  can't point a suite at the hosted dev or production project.
- Keys and the database URL are left out of `repr()`, so they never land in a
  failure report.
- The service-role key is for fixtures only (creating and deleting users).
  Send the request under test as a real user or as nobody.

## Versioning

Semantic versioning, recorded in [CHANGELOG.md](CHANGELOG.md). The version
lives in one place, `testkit.__version__`. While it's 0.x, a minor release may
change the public API; the changelog says how to update. Anything not listed
above, or starting with `_`, can change in any release.

Both suites install it from this folder rather than from a package index, so a
change is tested by both suites' CI before it merges.

## Working on the testkit

Its own tests run offline (fake HTTP transports and a real stub on a free
port), so they need no Docker and take seconds:

```bash
cd testkit
pip install -e ".[test]" ruff mypy   # or use api-tests/.venv, which has all of it
pytest && ruff check . && ruff format --check . && mypy
```

CI runs the same in the API job, before the API suite. When you change the
public API: bump `__version__` in `src/testkit/__init__.py`, add a changelog
entry, and run both suites.
