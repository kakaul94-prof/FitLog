"""Shared fixtures: settings, API clients, test users, tables and database access.

Test data rules:
- Every user is created for this run, with an email that carries the run id and
  the xdist worker id, so parallel workers and reruns never share state.
- Users are created with the service-role key (fixtures only), then signed in
  through the real password endpoint, so every request under test carries a
  genuine user token and the public anon key.
- Deleting a user at the end cascades to every row they own.
- Database tests run inside a transaction that is always rolled back.
"""

import os
import secrets
from collections.abc import Iterator
from typing import NoReturn

import httpx
import pytest
from psycopg import Connection
from psycopg.rows import DictRow

from testkit.anthropic_stub import AnthropicStub
from testkit.auth import AdminAuth, AuthClient, SignedInUser
from testkit.config import Settings
from testkit.db import connect, create_auth_user
from testkit.functions import FunctionsClient
from testkit.rest import RestClient
from testkit.storage import StorageClient
from testkit.tables import INSERTABLE, TABLES, TableSpec
from testkit.users import UserFactory

# -- configuration and clients -------------------------------------------------


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env()


@pytest.fixture(scope="session")
def http() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=15) as client:
        yield client


@pytest.fixture(scope="session")
def run_id(worker_id: str) -> str:
    """Unique per run and per xdist worker ("gw0", "gw1"... or "master")."""
    return f"{secrets.token_hex(3)}{worker_id}"


@pytest.fixture(scope="session")
def auth(http: httpx.Client, settings: Settings) -> AuthClient:
    return AuthClient(http, settings.supabase_url, settings.anon_key)


@pytest.fixture(scope="session")
def admin(http: httpx.Client, settings: Settings) -> AdminAuth:
    return AdminAuth(http, settings.supabase_url, settings.service_role_key)


@pytest.fixture(scope="session")
def anon_api(http: httpx.Client, settings: Settings) -> RestClient:
    """The REST API with only the public anon key, i.e. a signed-out visitor."""
    return RestClient(http, settings.supabase_url, settings.anon_key)


@pytest.fixture(scope="session")
def anon_storage(http: httpx.Client, settings: Settings) -> StorageClient:
    return StorageClient(http, settings.supabase_url, settings.anon_key)


# -- users ---------------------------------------------------------------------


@pytest.fixture(scope="session")
def users(admin: AdminAuth, auth: AuthClient, run_id: str) -> Iterator[UserFactory]:
    factory = UserFactory(admin, auth, run_id)
    yield factory
    factory.delete_all()


@pytest.fixture(scope="session")
def owner(users: UserFactory) -> SignedInUser:
    """The user whose data the isolation tests try to reach."""
    return users.create("owner")


@pytest.fixture(scope="session")
def intruder(users: UserFactory) -> SignedInUser:
    """A second, ordinary signed-in user trying to reach the owner's data."""
    return users.create("intruder")


@pytest.fixture
def fresh_user(users: UserFactory) -> SignedInUser:
    """A brand-new user, for tests that change per-user state such as the profile."""
    return users.create("fresh")


@pytest.fixture(scope="session")
def owner_api(anon_api: RestClient, owner: SignedInUser) -> RestClient:
    return anon_api.as_user(owner.access_token)


@pytest.fixture(scope="session")
def intruder_api(anon_api: RestClient, intruder: SignedInUser) -> RestClient:
    return anon_api.as_user(intruder.access_token)


@pytest.fixture
def fresh_api(anon_api: RestClient, fresh_user: SignedInUser) -> RestClient:
    return anon_api.as_user(fresh_user.access_token)


# -- the per-user tables ---------------------------------------------------------


@pytest.fixture(params=TABLES, ids=str)
def table(request: pytest.FixtureRequest) -> TableSpec:
    """Runs the requesting test once per table in testkit/tables.py."""
    spec: TableSpec = request.param
    return spec


@pytest.fixture(params=INSERTABLE, ids=str)
def insertable(request: pytest.FixtureRequest) -> TableSpec:
    """Like `table`, minus the profile (made by the signup trigger, never inserted)."""
    spec: TableSpec = request.param
    return spec


# -- database ------------------------------------------------------------------


@pytest.fixture(scope="session")
def db_conn(settings: Settings) -> Iterator[Connection[DictRow]]:
    conn = connect(settings.db_url)
    yield conn
    conn.close()


@pytest.fixture
def db(db_conn: Connection[DictRow]) -> Iterator[Connection[DictRow]]:
    """A connection inside a transaction that is always rolled back."""
    with db_conn.transaction(force_rollback=True):
        yield db_conn


@pytest.fixture
def db_owner(db: Connection[DictRow]) -> str:
    return create_auth_user(db)


@pytest.fixture
def db_intruder(db: Connection[DictRow]) -> str:
    return create_auth_user(db)


# -- Pages Functions -------------------------------------------------------------


def _functions_server_missing() -> NoReturn:
    message = (
        "The Pages Functions server isn't running. Start it with "
        "`bash api-tests/scripts/start-functions.sh --bg` and export what it prints "
        "(or run `make test-api`, which does both)."
    )
    # In CI a skipped functions test would be a silent gap, so it's an error there.
    if os.environ.get("CI"):
        pytest.fail(message, pytrace=False)
    pytest.skip(message)


@pytest.fixture(scope="session")
def functions(http: httpx.Client, settings: Settings) -> FunctionsClient:
    """The /api functions, called as a signed-out visitor (see `as_user`)."""
    if settings.functions_url is None:
        _functions_server_missing()
    return FunctionsClient(http, settings.functions_url)


@pytest.fixture
def claude(http: httpx.Client, settings: Settings) -> AnthropicStub:
    """The recording stand-in for the Claude API, emptied before each test."""
    if settings.stub_url is None:
        _functions_server_missing()
    stub = AnthropicStub(http, settings.stub_url)
    stub.reset()
    return stub


# -- reporting -------------------------------------------------------------------------

# Folder -> the feature it reports under in Allure ("Behaviors" view).
AREAS = {
    "auth": "Authentication",
    "authz": "Authorization and data isolation",
    "contracts": "API contracts",
    "validation": "Validation and constraints",
    "security": "Sensitive data",
    "functions": "Pages Functions",
    "bdd": "Scenarios (BDD)",
}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        area = AREAS.get(item.path.parent.name)
        if area:
            item.add_marker(pytest.mark.allure_label(area, label_type="feature"))
