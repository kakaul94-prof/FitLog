"""Which tokens each API surface accepts: only genuine, current ones.

Every kind of bad token in `testkit.tokens.FORGED_TOKENS` (expired, signed with
the wrong key, claims edited, signature stripped, `alg: none`, garbage) is tried
against every surface a signed-in user talks to: the database API (PostgREST),
file storage, the auth API and the Pages Functions. Each bad token impersonates
the owner, so being let in would hand over the owner's data.

Each surface also has a control case: a correctly signed, unexpired token built
the same way is accepted, so a rejection can only be down to what was broken.
"""

from collections.abc import Callable, Iterator
from uuid import uuid4

import httpx
import pytest

from testkit.auth import AuthClient, SignedInUser
from testkit.config import Settings
from testkit.models import parse_error
from testkit.rest import RestClient
from testkit.storage import StorageClient, effective_status
from testkit.tokens import FORGED_TOKENS, make_token

BUCKET = "form-videos"
Call = Callable[[str | None], httpx.Response]  # sends one request with this bearer token


@pytest.fixture(scope="module")
def owner_clip(anon_storage: StorageClient, owner: SignedInUser) -> Iterator[str]:
    """A file in the owner's storage folder, so a listing has something to leak."""
    storage = anon_storage.as_user(owner.access_token)
    path = f"{owner.id}/{uuid4().hex}.mp4"
    assert storage.upload(BUCKET, path, b"\x00\x00\x00\x18ftypmp42").status_code == 200
    yield path
    storage.remove(BUCKET, [path])


@pytest.fixture(
    params=[
        "rest",
        "storage",
        "auth",
        # Shares the Claude stub with the functions tests, so it runs on their worker.
        pytest.param(
            "functions", marks=[pytest.mark.functions, pytest.mark.xdist_group("functions")]
        ),
    ]
)
def surface(
    request: pytest.FixtureRequest,
    anon_api: RestClient,
    anon_storage: StorageClient,
    auth: AuthClient,
    owner: SignedInUser,
    owner_clip: str,
) -> Call:
    """One API surface, as a function of the bearer token to send (None: no token)."""
    match request.param:
        case "rest":
            return lambda token: (anon_api.as_user(token) if token else anon_api).select("profiles")
        case "storage":
            return lambda token: (
                anon_storage.as_user(token) if token else anon_storage
            ).list_folder(BUCKET, owner.id)
        case "auth":
            return lambda token: auth.get_user(token)
        case _:
            functions = request.getfixturevalue("functions")
            return lambda token: functions.as_user(token).ask_trainer("Am I signed in?")


def _owner_data_in(resp: httpx.Response, owner: SignedInUser, clip: str) -> bool:
    return owner.id in resp.text or clip.split("/")[-1] in resp.text


def test_control_a_correctly_signed_token_is_accepted(
    surface: Call, settings: Settings, owner: SignedInUser, owner_clip: str
) -> None:
    token = make_token(settings.jwt_secret, sub=owner.id, expires_in=300)

    resp = surface(token)

    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("kind", FORGED_TOKENS)
def test_forged_and_tampered_tokens_are_refused(
    surface: Call,
    kind: str,
    settings: Settings,
    owner: SignedInUser,
    intruder: SignedInUser,
    owner_clip: str,
) -> None:
    forged = FORGED_TOKENS[kind](intruder.access_token, owner.id, settings.jwt_secret)

    resp = surface(forged)

    assert effective_status(resp) in {401, 403}, f"{kind} token was accepted: {resp.text}"
    assert not _owner_data_in(resp, owner, owner_clip)


def test_requests_without_a_token_get_nothing(
    surface: Call, owner: SignedInUser, owner_clip: str
) -> None:
    """Signed out: either refused outright or answered as an anonymous visitor."""
    resp = surface(None)

    refused = effective_status(resp) in {401, 403}
    empty = resp.status_code == 200 and resp.json() == []
    assert refused or empty, resp.text
    assert not _owner_data_in(resp, owner, owner_clip)


# -- the database API with no credentials at all ------------------------------------


def test_requests_with_no_api_key_and_no_token_see_and_change_nothing(
    http: httpx.Client, settings: Settings, owner_api: RestClient
) -> None:
    """No API key and no token.

    Hosted Supabase's gateway refuses such a request outright; the local stack's
    gateway lets it through as the anonymous role. Either way it must come away
    with nothing, so that's what this checks (against the local stack).
    """
    owner_api.create("foods", {"name": f"Visible only to me {uuid4().hex[:8]}"})
    url = f"{settings.supabase_url}/rest/v1/foods"

    read = http.get(url, params={"select": "*"})
    write = http.post(url, json={"name": "Sneaky snack"})

    assert read.status_code == 200
    assert read.json() == []
    assert write.status_code == 401
    assert parse_error(write).code == "42501"


@pytest.mark.parametrize(
    "token",
    ["Bearer", "a.b.c", "eyJhbGciOiJIUzI1NiJ9.e30.", "x" * 8000],
    ids=["a-word", "three-junk-parts", "empty-claims", "oversized"],
)
def test_database_api_rejects_malformed_tokens(anon_api: RestClient, token: str) -> None:
    resp = anon_api.as_user(token).select("foods")

    assert resp.status_code == 401
