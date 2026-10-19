"""Privilege escalation: an ordinary user trying to act as an admin.

Row-level security keeps users apart; these tests check the layer above it:
that a normal signed-in user (or a signed-out visitor) can't reach admin-only
endpoints, other schemas, server-side functions, storage settings or their own
role, whether through the API or with a direct database session.
"""

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from psycopg import Connection, errors
from psycopg.rows import DictRow

from testkit.auth import AuthClient, SignedInUser
from testkit.db import acting_as
from testkit.rest import RestClient
from testkit.storage import StorageClient, effective_status
from testkit.tokens import claims_of

DB = Connection[DictRow]


# -- the auth admin API ---------------------------------------------------------------


PLANTED_USER = {"email": "planted@api.test", "password": "planted-password"}

ADMIN_CALLS = [
    pytest.param("GET", "users", None, id="list-all-users"),
    pytest.param("POST", "users", PLANTED_USER, id="create-user"),
    pytest.param("PUT", "users/{victim}", {"email": "x@api.test"}, id="change-anothers-email"),
    pytest.param("DELETE", "users/{victim}", None, id="delete-another-user"),
    pytest.param(
        "POST", "generate_link", {"type": "magiclink", "email": "{email}"}, id="sign-in-link"
    ),
]


@pytest.mark.parametrize("as_who", ["signed-in user", "signed-out visitor"])
@pytest.mark.parametrize(("method", "path", "body"), ADMIN_CALLS)
def test_admin_endpoints_refuse_ordinary_callers(
    auth: AuthClient,
    owner: SignedInUser,
    intruder: SignedInUser,
    as_who: str,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    token = intruder.access_token if as_who == "signed-in user" else None
    path = path.format(victim=owner.id)
    if body:
        body = {k: v.format(email=owner.email) for k, v in body.items()}

    resp = auth.admin_request(method, path, token, body)

    assert resp.status_code in {401, 403}, resp.text
    assert owner.email not in resp.text
    assert auth.get_user(owner.access_token).json()["email"] == owner.email


def test_users_cannot_grant_themselves_app_metadata(
    auth: AuthClient, fresh_user: SignedInUser
) -> None:
    """app_metadata is server-controlled (roles, providers); only an admin may set it."""
    auth.update_user(fresh_user.access_token, {"app_metadata": {"role": "admin"}})

    user = auth.get_user(fresh_user.access_token).json()

    assert "role" not in user["app_metadata"]


def test_a_role_in_user_metadata_does_not_change_the_token_role(
    auth: AuthClient, fresh_user: SignedInUser, anon_api: RestClient
) -> None:
    """user_metadata is user-editable, so nothing may trust a role stored there."""
    resp = auth.update_user(fresh_user.access_token, {"data": {"role": "service_role"}})
    assert resp.status_code == 200

    refreshed = auth.refresh(fresh_user.refresh_token).json()["access_token"]

    assert claims_of(refreshed)["role"] == "authenticated"
    assert anon_api.as_user(refreshed).select("profiles").json()[0]["id"] == fresh_user.id


# -- the database API: schemas and functions ---------------------------------------------


@pytest.mark.parametrize(("schema", "table"), [("auth", "users"), ("storage", "buckets")])
def test_internal_schemas_are_not_exposed(
    intruder_api: RestClient, schema: str, table: str
) -> None:
    read = intruder_api.select(table, schema=schema)
    write = intruder_api.insert(table, {"id": "planted"}, schema=schema)

    for resp in (read, write):
        assert resp.status_code == 406, resp.text
        assert resp.json()["code"] == "PGRST106"  # schema not exposed


@pytest.mark.parametrize("function", ["handle_new_user", "set_updated_at"])
def test_trigger_functions_cannot_be_called_as_rpcs(
    intruder_api: RestClient, function: str
) -> None:
    resp = intruder_api.rpc(function)

    assert resp.status_code == 404
    assert resp.json()["code"] == "PGRST202"  # no such RPC


# -- storage settings ---------------------------------------------------------------------


@pytest.fixture
def intruder_storage(anon_storage: StorageClient, intruder: SignedInUser) -> StorageClient:
    return anon_storage.as_user(intruder.access_token)


def test_users_cannot_see_bucket_settings(intruder_storage: StorageClient) -> None:
    resp = intruder_storage.list_buckets()

    assert (resp.status_code, resp.json()) == (200, [])


BucketAttempt = Callable[[StorageClient], httpx.Response]

BUCKET_CHANGES: dict[str, BucketAttempt] = {
    "make-videos-public": lambda s: s.update_bucket("form-videos", {"public": True}),
    "delete-the-videos-bucket": lambda s: s.delete_bucket("form-videos"),
    "create-a-public-bucket": lambda s: s.create_bucket(
        {"id": "drop", "name": "drop", "public": True}
    ),
}


@pytest.mark.parametrize("change", BUCKET_CHANGES)
def test_users_cannot_change_buckets(intruder_storage: StorageClient, db: DB, change: str) -> None:
    resp = BUCKET_CHANGES[change](intruder_storage)

    assert effective_status(resp) in {403, 404}, resp.text
    buckets = db.execute("select id, public from storage.buckets order by id").fetchall()
    assert buckets == [{"id": "form-videos", "public": False}]


# -- a direct database session as an ordinary user ----------------------------------------


# Not here: `set role service_role`. Through the API a user never runs SQL, and
# PostgREST picks the role from the verified token (see the altered-role token
# tests); in this harness the session user is a superuser, so the test would
# only prove the harness can switch roles.
ESCALATIONS = [
    pytest.param("alter table public.foods disable row level security", id="disable-rls"),
    pytest.param("drop policy foods_rw_own on public.foods", id="drop-a-policy"),
    pytest.param("select email from auth.users", id="read-auth-users"),
    pytest.param("create table public.planted (id int)", id="create-a-table"),
]


@pytest.mark.parametrize("statement", ESCALATIONS)
def test_database_role_cannot_escalate(db: DB, db_intruder: str, statement: str) -> None:
    with pytest.raises(errors.InsufficientPrivilege), acting_as(db, db_intruder) as cur:
        cur.execute(statement)


def test_database_role_cannot_publish_a_bucket(db: DB, db_intruder: str) -> None:
    """Storage's tables have RLS too: the update matches no rows it may change."""
    with acting_as(db, db_intruder) as cur:
        cur.execute("update storage.buckets set public = true")
        assert cur.rowcount == 0

    assert db.execute("select bool_or(public) as any_public from storage.buckets").fetchone() == {
        "any_public": False
    }
