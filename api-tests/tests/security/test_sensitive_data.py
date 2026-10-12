"""Sensitive data: what a response may never contain, whoever asked and however it failed.

Error paths are where internals leak: a stack trace, a connection string, a
key, a token, or a detail that describes another user's row. Each case below
provokes a different failure from a different service and runs the response
through `testkit.leaks.find_leaks`, with the stack's real secrets and the
owner's private values as the things that must not appear.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from uuid import uuid4

import httpx
import pytest

from testkit.anthropic_stub import AnthropicStub, Reply
from testkit.auth import AuthClient, SignedInUser
from testkit.config import FAKE_ANTHROPIC_KEY, Settings
from testkit.factories import build_row, create_row
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.rest import RestClient, Row
from testkit.storage import StorageClient
from testkit.tables import TABLES, TABLES_BY_NAME


@dataclass(frozen=True)
class OwnersSecrets:
    """Private values only the owner should ever see in a response."""

    food: Row
    clip: str

    def values(self, owner: SignedInUser) -> list[str]:
        return [owner.email, self.food["name"], self.food["id"], self.clip]


@pytest.fixture(scope="module")
def private(
    owner_api: RestClient, anon_storage: StorageClient, owner: SignedInUser
) -> Iterator[OwnersSecrets]:
    food = owner_api.create("foods", {"name": f"Private recipe {uuid4().hex[:10]}"})
    storage = anon_storage.as_user(owner.access_token)
    clip = f"{owner.id}/{uuid4().hex}.mp4"
    assert storage.upload("form-videos", clip, b"\x00\x00\x00\x18ftypmp42").status_code == 200
    yield OwnersSecrets(food=food, clip=clip)
    storage.remove("form-videos", [clip])


@pytest.fixture(scope="module")
def stack_secrets(settings: Settings) -> dict[str, str]:
    return {
        "service-role key": settings.service_role_key,
        "JWT signing secret": settings.jwt_secret,
        "database URL": settings.db_url,
        "Claude API key": FAKE_ANTHROPIC_KEY,
    }


@dataclass(frozen=True)
class Clients:
    intruder_api: RestClient
    intruder_storage: StorageClient
    anon_api: RestClient
    auth: AuthClient
    owner: SignedInUser
    private: OwnersSecrets


@pytest.fixture
def clients(
    intruder_api: RestClient,
    anon_storage: StorageClient,
    intruder: SignedInUser,
    anon_api: RestClient,
    auth: AuthClient,
    owner: SignedInUser,
    private: OwnersSecrets,
) -> Clients:
    return Clients(
        intruder_api,
        anon_storage.as_user(intruder.access_token),
        anon_api,
        auth,
        owner,
        private,
    )


def _diary_row(c: Clients, **changes: object) -> Row:
    return build_row(c.intruder_api, TABLES_BY_NAME["diary_entries"]) | changes


# Each provokes a different refusal; none may say more than "no".
FAILURES: dict[str, Callable[[Clients], httpx.Response]] = {
    "wrong-type": lambda c: c.intruder_api.insert("diary_entries", _diary_row(c, servings="two")),
    "check-violation": lambda c: c.intruder_api.insert("diary_entries", _diary_row(c, meal="x")),
    "unknown-column": lambda c: c.intruder_api.insert("diary_entries", _diary_row(c, owner=1)),
    "row-for-another-user": lambda c: c.intruder_api.insert(
        "diary_entries", _diary_row(c, user_id=c.owner.id)
    ),
    "link-to-another-users-food": lambda c: c.intruder_api.insert(
        "diary_entries", _diary_row(c, food_id=c.private.food["id"])
    ),
    "take-over-another-users-row": lambda c: c.intruder_api.insert(
        "foods", {"id": c.private.food["id"], "name": "Mine now"}, upsert_on="id"
    ),
    "signed-out-write": lambda c: c.anon_api.insert("foods", {"name": "Anonymous snack"}),
    "missing-table": lambda c: c.intruder_api.select("payments"),
    "bad-filter": lambda c: c.intruder_api.select("foods", {"id": "not-a-uuid"}),
    "wrong-password": lambda c: c.auth.sign_in(c.owner.email, "not-the-password"),
    "admin-endpoint": lambda c: c.auth.admin_request("GET", "users", c.intruder_api.access_token),
    "bad-refresh-token": lambda c: c.auth.refresh("not-a-refresh-token"),
    "another-users-clip": lambda c: c.intruder_storage.download("form-videos", c.private.clip),
    "upload-to-another-users-folder": lambda c: c.intruder_storage.upload(
        "form-videos", f"{c.owner.id}/planted.mp4", b"x"
    ),
}


@pytest.mark.parametrize("failure", FAILURES)
def test_error_responses_leak_no_secrets_internals_or_other_users_data(
    failure: str, clients: Clients, stack_secrets: dict[str, str]
) -> None:
    resp = FAILURES[failure](clients)

    assert resp.is_client_error, f"expected a refusal, got {resp.status_code}: {resp.text}"
    others = clients.private.values(clients.owner)
    if failure in {"link-to-another-users-food", "take-over-another-users-row"}:
        # The caller supplied this id, so echoing it back reveals nothing new.
        others = [v for v in others if v != clients.private.food["id"]]
    assert find_leaks(resp.text, secrets=stack_secrets, others_data=others) == []


def test_a_full_export_contains_only_your_own_data(
    intruder_api: RestClient, owner_api: RestClient, owner: SignedInUser
) -> None:
    """Settings → Export reads every table with the user's own session; mirror that."""
    owners_ids = [create_row(owner_api, spec)["id"] for spec in TABLES]

    export = {spec.name: intruder_api.rows(spec.name) for spec in TABLES}

    dumped = str(export)
    assert owner.id not in dumped
    assert [row_id for row_id in owners_ids if row_id in dumped] == []


# -- the trainer never hands back its prompt or key -------------------------------------


@pytest.mark.functions
@pytest.mark.xdist_group("functions")
@pytest.mark.parametrize(
    "request_kind",
    ["signed-out", "not-json", "no-question", "claude-rejects-the-key", "claude-overloaded"],
)
def test_trainer_error_responses_never_include_its_prompt_or_key(
    request_kind: str,
    functions: FunctionsClient,
    claude: AnthropicStub,
    owner: SignedInUser,
    stack_secrets: dict[str, str],
) -> None:
    trainer = functions.as_user(owner.access_token)
    match request_kind:
        case "signed-out":
            resp = functions.ask_trainer("q")
        case "not-json":
            resp = trainer.post("trainer", content=b"{")
        case "no-question":
            resp = trainer.post("trainer", {"messages": []})
        case "claude-rejects-the-key":
            claude.queue(Reply.error(401, "authentication_error", "invalid x-api-key"))
            resp = trainer.ask_trainer("q", context="private training log")
        case _:
            claude.queue(Reply.error(529, "overloaded_error", "Overloaded"))
            resp = trainer.ask_trainer("q", context="private training log")

    assert resp.status_code >= 400
    assert "You are the training coach inside FitLog" not in resp.text
    assert "private training log" not in resp.text
    assert find_leaks(resp.text, secrets=stack_secrets) == []
