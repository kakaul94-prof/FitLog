"""The HTTP clients send what the app sends, checked against a fake transport.

Each test answers from a small route table and inspects the requests the client
made, so no Supabase stack or functions server is needed.
"""

import json
from collections.abc import Callable

import httpx
import pytest

from testkit.auth import AdminAuth, AuthClient
from testkit.functions import FunctionsClient
from testkit.rest import ApiError, RestClient
from testkit.storage import StorageClient, effective_status

BASE = "http://127.0.0.1:54321"
ANON = "anon-key"
Respond = Callable[[httpx.Request], httpx.Response]


def fake_http(seen: list[httpx.Request], respond: Respond | None = None) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return respond(request) if respond else httpx.Response(200, json=[])

    return httpx.Client(transport=httpx.MockTransport(handle))


# -- PostgREST ---------------------------------------------------------------------


def test_signed_out_requests_carry_the_anon_key_like_supabase_js() -> None:
    seen: list[httpx.Request] = []
    RestClient(fake_http(seen), BASE, ANON).select("foods")
    assert seen[0].headers["apikey"] == ANON
    assert seen[0].headers["authorization"] == f"Bearer {ANON}"


def test_as_user_sends_the_users_token_and_leaves_the_original_signed_out() -> None:
    seen: list[httpx.Request] = []
    signed_out = RestClient(fake_http(seen), BASE, ANON)
    signed_out.as_user("alice-token").select("foods", {"id": "f1"}, "id,name")
    signed_out.select("foods")
    assert seen[0].headers["authorization"] == "Bearer alice-token"
    assert seen[0].url.params["id"] == "eq.f1"
    assert seen[0].url.params["select"] == "id,name"
    assert seen[1].headers["authorization"] == f"Bearer {ANON}"


def test_insert_with_upsert_asks_postgrest_to_merge() -> None:
    seen: list[httpx.Request] = []
    api = RestClient(fake_http(seen), BASE, ANON, "token")
    api.insert("exercise_notes", {"exercise_key": "squat"}, upsert_on="exercise_key", schema="s")
    request = seen[0]
    assert request.url.path == "/rest/v1/exercise_notes"
    assert request.url.params["on_conflict"] == "exercise_key"
    assert request.headers["prefer"] == "return=representation,resolution=merge-duplicates"
    assert request.headers["content-profile"] == request.headers["accept-profile"] == "s"
    assert json.loads(request.content) == {"exercise_key": "squat"}


def test_create_returns_the_row_and_fails_setup_loudly_with_the_body() -> None:
    created = RestClient(
        fake_http([], lambda _r: httpx.Response(201, json=[{"id": "w1"}])), BASE, ANON
    ).create("workouts", {"name": "Legs"})
    assert created == {"id": "w1"}

    refused = RestClient(
        fake_http([], lambda _r: httpx.Response(403, json={"message": "row-level security"})),
        BASE,
        ANON,
    )
    with pytest.raises(ApiError, match=r"POST /rest/v1/workouts -> 403.*row-level security"):
        refused.create("workouts", {"name": "Legs"})


# -- Auth ----------------------------------------------------------------------------


def test_signed_in_returns_a_real_session_from_the_password_grant() -> None:
    seen: list[httpx.Request] = []
    session = {"user": {"id": "u1"}, "access_token": "at", "refresh_token": "rt"}
    auth = AuthClient(fake_http(seen, lambda _r: httpx.Response(200, json=session)), BASE, ANON)
    user = auth.signed_in("alice@api.test", "pw-123456")
    assert (user.id, user.access_token, user.refresh_token) == ("u1", "at", "rt")
    assert seen[0].url.path == "/auth/v1/token"
    assert seen[0].url.params["grant_type"] == "password"
    assert "authorization" not in seen[0].headers  # signing in needs no token


def test_admin_calls_use_the_service_role_key() -> None:
    seen: list[httpx.Request] = []
    users = {"users": [{"id": "u1", "email": "a@api.test"}, {"id": "u2", "email": "b@api.test"}]}

    def respond(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"id": "new-user"})
        return httpx.Response(200, json=users)

    admin = AdminAuth(fake_http(seen, respond), BASE, "service-role")
    assert admin.create_user("c@api.test", "pw-123456") == "new-user"
    assert admin.find_user_id("b@api.test") == "u2"
    assert admin.find_user_id("nobody@api.test") is None
    assert json.loads(seen[0].content)["email_confirm"] is True
    assert {r.headers["authorization"] for r in seen} == {"Bearer service-role"}


# -- Pages Functions -------------------------------------------------------------------


def test_ask_trainer_posts_the_chat_the_way_the_app_does() -> None:
    seen: list[httpx.Request] = []
    functions = FunctionsClient(fake_http(seen), "http://127.0.0.1:8788")
    functions.as_user("alice-token").ask_trainer(
        "And for squats?",
        history=[
            {"role": "user", "content": "Bench tips?"},
            {"role": "assistant", "content": "Arch."},
        ],
        context="log",
        memory=["prefers mornings"],
    )
    functions.ask_trainer("Signed out?")
    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/api/trainer"
    assert [m["content"] for m in body["messages"]] == ["Bench tips?", "Arch.", "And for squats?"]
    assert (body["context"], body["memory"]) == ("log", ["prefers mornings"])
    assert seen[0].headers["authorization"] == "Bearer alice-token"
    assert "authorization" not in seen[1].headers


def test_ask_trainer_timed_streams_the_same_request_and_times_it() -> None:
    seen: list[httpx.Request] = []
    functions = FunctionsClient(
        fake_http(seen, lambda r: httpx.Response(200, text="Squat 230.")), "http://127.0.0.1:8788"
    )

    reply = functions.as_user("alice-token").ask_trainer_timed("Squat?", context="log")

    assert (reply.status, reply.text) == (200, "Squat 230.")
    assert 0 <= reply.first_byte_ms <= reply.total_ms
    assert seen[0].url.path == "/api/trainer"
    assert json.loads(seen[0].content)["messages"] == [{"role": "user", "content": "Squat?"}]
    assert seen[0].headers["authorization"] == "Bearer alice-token"


# -- Storage ---------------------------------------------------------------------------


def test_storage_uploads_as_the_user() -> None:
    seen: list[httpx.Request] = []
    StorageClient(fake_http(seen), BASE, ANON).as_user("t").upload("form-videos", "u1/a.mp4", b"x")
    assert seen[0].url.path == "/storage/v1/object/form-videos/u1/a.mp4"
    assert (seen[0].headers["authorization"], seen[0].headers["content-type"]) == (
        "Bearer t",
        "video/mp4",
    )


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (400, {"statusCode": "403", "error": "Unauthorized"}, 403),  # Storage's own convention
        (400, {"statusCode": "Bad"}, 400),
        (400, {"message": "bad request"}, 400),
        (404, {"statusCode": "403"}, 404),  # only a 400 is reinterpreted
        (200, [], 200),
    ],
)
def test_effective_status_reads_storages_real_status(
    status: int, body: object, expected: int
) -> None:
    assert effective_status(httpx.Response(status, json=body)) == expected


def test_effective_status_ignores_a_400_that_isnt_json() -> None:
    assert effective_status(httpx.Response(400, text="<html>bad</html>")) == 400
