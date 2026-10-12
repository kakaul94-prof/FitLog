"""Meal-photo scan, recipe import and label scan: who may call them and what they send.

Each of these spends money (Claude) or quota (Workers AI) per call, so the
first thing checked is that only signed-in users get through. scan-plate's
Claude call is then checked end to end through the recording stub. Locally
there is no Workers AI binding, so scan-label is covered up to its sign-in
gate, and import-recipe up to the URL guard that runs before it fetches a page.
"""

import base64

import pytest

from testkit.anthropic_stub import AnthropicStub, Reply
from testkit.auth import AuthClient, SignedInUser
from testkit.config import FAKE_ANTHROPIC_KEY
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.models import ClaudeRequest, FunctionError
from testkit.users import UserFactory

pytestmark = [pytest.mark.functions, pytest.mark.xdist_group("functions")]

TINY_JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64).decode()
VALID_BODIES = {
    "trainer": {"messages": [{"role": "user", "content": "Hi"}]},
    "scan-plate": {"image": f"data:image/jpeg;base64,{TINY_JPEG}"},
    "scan-label": {"image": TINY_JPEG},
    "import-recipe": {"url": "https://example.com/banana-bread"},
}


@pytest.fixture
def signed_in(functions: FunctionsClient, owner: SignedInUser) -> FunctionsClient:
    return functions.as_user(owner.access_token)


# -- only signed-in users -----------------------------------------------------------------


@pytest.mark.parametrize("endpoint", VALID_BODIES)
def test_signed_out_callers_are_refused(
    functions: FunctionsClient, claude: AnthropicStub, endpoint: str
) -> None:
    resp = functions.post(endpoint, VALID_BODIES[endpoint])

    assert resp.status_code == 401, resp.text
    FunctionError.model_validate_json(resp.content)
    assert claude.calls() == []


@pytest.mark.parametrize("endpoint", VALID_BODIES)
def test_a_session_that_was_signed_out_is_refused(
    functions: FunctionsClient,
    claude: AnthropicStub,
    auth: AuthClient,
    users: UserFactory,
    endpoint: str,
) -> None:
    """The token is still unexpired, but the session behind it is gone."""
    user = users.create("signed-out")
    auth.sign_out(user.access_token)

    resp = functions.as_user(user.access_token).post(endpoint, VALID_BODIES[endpoint])

    assert resp.status_code == 401, resp.text
    assert claude.calls() == []


# -- scan-plate ------------------------------------------------------------------------------


def test_scan_plate_returns_claudes_structured_estimate(
    signed_in: FunctionsClient, claude: AnthropicStub
) -> None:
    estimate = (
        '{"items":[{"name":"White rice","grams":150,"kcal":195,"protein":4,"carb":42,"fat":0.4}]}'
    )
    claude.queue(Reply.message(estimate))

    resp = signed_in.post("scan-plate", VALID_BODIES["scan-plate"])

    assert resp.status_code == 200
    assert resp.json()["items"][0]["name"] == "White rice"


def test_scan_plate_sends_the_photo_with_a_strict_output_schema(
    signed_in: FunctionsClient, claude: AnthropicStub
) -> None:
    claude.queue(Reply.message('{"items": []}'))

    signed_in.post("scan-plate", VALID_BODIES["scan-plate"])

    call = claude.only_call()
    sent = ClaudeRequest.model_validate(call.body)
    assert call.headers["x-api-key"] == FAKE_ANTHROPIC_KEY
    assert sent.model.startswith("claude-haiku-")
    assert sent.max_tokens <= 2048
    assert sent.output_config is not None, "structured output keeps parsing reliable"
    assert sent.output_config["format"]["type"] == "json_schema"
    assert sent.output_config["format"]["schema"]["required"] == ["items"]
    content = sent.messages[0].content
    assert isinstance(content, list), "a photo is sent as content blocks"
    image, prompt = content
    assert image["source"] == {"type": "base64", "media_type": "image/jpeg", "data": TINY_JPEG}
    assert prompt["type"] == "text"
    assert "nutrition estimator" in prompt["text"]


def test_scan_plate_without_an_image_never_calls_claude(
    signed_in: FunctionsClient, claude: AnthropicStub
) -> None:
    resp = signed_in.post("scan-plate", {})

    assert resp.status_code == 400
    assert claude.calls() == []


@pytest.mark.parametrize(
    ("reply", "status"),
    [
        pytest.param(Reply.message("Sorry, I can't see any food here."), 422, id="not-json"),
        pytest.param(Reply.message(""), 422, id="empty-answer"),
        pytest.param(
            Reply.error(500, "api_error", "Internal server error"), 502, id="server-error"
        ),
        pytest.param(
            Reply.error(401, "authentication_error", "invalid x-api-key"), 502, id="bad-key"
        ),
    ],
)
def test_scan_plate_failures_return_one_clear_message(
    signed_in: FunctionsClient, claude: AnthropicStub, reply: Reply, status: int
) -> None:
    claude.queue(reply)

    resp = signed_in.post("scan-plate", VALID_BODIES["scan-plate"])

    assert resp.status_code == status
    FunctionError.model_validate_json(resp.content)  # no upstream detail
    assert find_leaks(resp.text, secrets={"Claude API key": FAKE_ANTHROPIC_KEY}) == []


# -- import-recipe: the server fetches a URL the user typed ------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        pytest.param("ftp://example.com/recipe", id="not-http"),
        pytest.param("javascript:alert(1)", id="javascript"),
        pytest.param("http://user:secret@example.com/recipe", id="credentials-in-url"),
        pytest.param("http://localhost:54321/rest/v1/", id="localhost"),
        pytest.param("http://127.0.0.1:54321/rest/v1/", id="loopback"),
        pytest.param("http://2130706433:54321/rest/v1/", id="loopback-as-a-number"),
        pytest.param("http://0x7f.1:54321/rest/v1/", id="loopback-in-hex"),
        pytest.param("http://[::1]:54321/rest/v1/", id="ipv6-loopback"),
        pytest.param("http://[::ffff:7f00:1]:54321/rest/v1/", id="ipv4-mapped-ipv6-loopback"),
        pytest.param("http://10.0.0.5/", id="private-10"),
        pytest.param("http://192.168.1.1/", id="private-192"),
        pytest.param("http://169.254.169.254/latest/meta-data/", id="cloud-metadata"),
        pytest.param("http://host.docker.internal:54321/", id="internal-name"),
    ],
)
def test_import_recipe_refuses_internal_and_odd_urls_before_fetching(
    signed_in: FunctionsClient, claude: AnthropicStub, url: str
) -> None:
    resp = signed_in.post("import-recipe", {"url": url})

    assert resp.status_code == 400, f"{url} got past the URL guard: {resp.text}"
    assert claude.calls() == []


def test_import_recipe_without_a_url_is_refused(
    signed_in: FunctionsClient, claude: AnthropicStub
) -> None:
    resp = signed_in.post("import-recipe", {})

    assert resp.status_code == 400
    assert claude.calls() == []
