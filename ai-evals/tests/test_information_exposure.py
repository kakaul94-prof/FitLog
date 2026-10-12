"""Information exposure: what reaches Claude, and what comes back to the browser.

- The API key goes to Claude in its header and nowhere else; the caller's
  session token and the server's other secrets never go at all.
- The context only ever holds the requesting user's own data. The function has
  no database access (the browser builds the snapshot under its own session), so
  this is checked twice: the app's snapshot builder under row-level security,
  and the function under concurrent requests from two users.
- Error messages tell the user what happened without naming internal config.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import pytest

from aievals.harness import ClientHarness, PagesFunction, TrainerInput
from aievals.personas import PersonaUser
from testkit.anthropic_stub import AnthropicStub, Reply
from testkit.config import FAKE_ANTHROPIC_KEY
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.models import FunctionError

pytestmark = pytest.mark.functions


# -- what reaches Claude -----------------------------------------------------------------


def test_the_api_key_travels_only_in_its_header(
    trainer: FunctionsClient, claude: AnthropicStub, sam_input: TrainerInput
) -> None:
    trainer.ask_trainer("q", context=sam_input.context, memory=sam_input.memory)

    call = claude.only_call()
    assert call.headers["x-api-key"] == FAKE_ANTHROPIC_KEY
    assert FAKE_ANTHROPIC_KEY not in json.dumps(call.body)


def test_the_callers_session_never_reaches_claude(
    trainer: FunctionsClient, claude: AnthropicStub, sam: PersonaUser, sam_input: TrainerInput
) -> None:
    trainer.ask_trainer("q", context=sam_input.context, memory=sam_input.memory)

    call = claude.only_call()
    assert "authorization" not in call.headers
    assert sam.user.access_token not in json.dumps([call.headers, call.body])


def test_server_secrets_never_reach_the_prompt(
    trainer: FunctionsClient,
    claude: AnthropicStub,
    sam_input: TrainerInput,
    server_secrets: dict[str, str],
) -> None:
    trainer.ask_trainer("q", context=sam_input.context, memory=sam_input.memory)

    assert find_leaks(json.dumps(claude.only_call().body), secrets=server_secrets) == []


# -- only the requesting user's data -------------------------------------------------


def test_the_snapshot_holds_only_the_signed_in_users_data(
    harness: ClientHarness, sam: PersonaUser, jordan: PersonaUser
) -> None:
    """Built after Jordan's rows exist, by the app's own code, as Sam."""
    mine = harness.trainer_input(sam.user)
    everything = "\n".join([mine.context, *mine.memory])

    assert [c for c in jordan.persona.canaries if c in everything] == []
    assert "Calorie goal: 2400/day" in mine.context  # and it is Sam's snapshot


def test_the_isolation_check_would_see_a_leak(harness: ClientHarness, jordan: PersonaUser) -> None:
    """Jordan's own snapshot carries every canary, so their absence for Sam means something."""
    theirs = harness.trainer_input(jordan.user)
    everything = "\n".join([theirs.context, *theirs.memory])

    assert [c for c in jordan.persona.canaries if c not in everything] == []


def test_users_asking_at_once_never_share_a_prompt(
    functions: FunctionsClient,
    claude: AnthropicStub,
    harness: ClientHarness,
    sam: PersonaUser,
    jordan: PersonaUser,
) -> None:
    people = [(sam, harness.trainer_input(sam.user)), (jordan, harness.trainer_input(jordan.user))]

    def ask(who: PersonaUser, given: TrainerInput) -> int:
        client = functions.as_user(who.user.access_token)
        return client.ask_trainer(
            "How am I doing?", context=given.context, memory=given.memory
        ).status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda pair: ask(*pair), people * 6))

    assert statuses == [200] * 12
    prompts = [call.body["system"] for call in claude.calls()]
    jordans = [any(c in p for c in jordan.persona.canaries) for p in prompts]
    sams = ["Calorie goal: 2400/day" in p for p in prompts]
    assert jordans.count(True) == 6
    assert [j and s for j, s in zip(jordans, sams, strict=True)] == [False] * 12
    assert [j or s for j, s in zip(jordans, sams, strict=True)] == [True] * 12


# -- what comes back to the browser ----------------------------------------------------

# Environment-variable names (ANTHROPIC_API_KEY, VITE_SUPABASE_URL...) and
# operator instructions belong in the function log, not in front of the user.
CONFIG_NAME = re.compile(r"\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b")
OPERATOR_HINT = re.compile(
    r"cloudflare|console\.anthropic|\bsecrets?\b|settings\s*[→>]|environment variable", re.I
)
# Instead: a short reason the owner can look up (ai-evals/README.md).
REASON_CODE = re.compile(r"\(code: [a-z-]+\)")

FAILURES = {
    "bad-key": Reply.error(401, "authentication_error", "invalid x-api-key"),
    "no-credit": Reply.error(400, "invalid_request_error", "Your credit balance is too low"),
    "rate-limited": Reply.error(429, "rate_limit_error", "Number of requests exceeded"),
    "overloaded": Reply.error(529, "overloaded_error", "Overloaded"),
    "server-error": Reply.error(500, "api_error", "Internal server error"),
    "connection-dropped": Reply.drop(),
}


@pytest.mark.parametrize("failure", FAILURES)
def test_error_messages_name_no_internal_config(
    trainer: FunctionsClient, claude: AnthropicStub, failure: str
) -> None:
    claude.queue(FAILURES[failure])

    resp = trainer.ask_trainer("q")

    message = FunctionError.model_validate_json(resp.content).error
    assert CONFIG_NAME.findall(message) == []
    assert OPERATOR_HINT.findall(message) == []
    assert REASON_CODE.search(message), "the user needs something short to report"


# Deploy mistakes the shared test server can't be put into, so the harness runs
# the function directly with exactly this environment.
MISCONFIGURED: dict[str, tuple[PagesFunction, int]] = {
    "no-supabase-config": ("middleware", 401),  # sign-ins can't be checked: fail closed
    "no-api-key": ("trainer", 503),
}


@pytest.mark.parametrize("deploy", MISCONFIGURED)
def test_a_misconfigured_deploy_fails_closed_and_names_no_config(
    harness: ClientHarness, deploy: str
) -> None:
    function, status = MISCONFIGURED[deploy]

    result = harness.call_function(function, {}, {"messages": [{"role": "user", "content": "q"}]})

    assert result.status == status
    message = FunctionError.model_validate_json(result.body).error
    assert CONFIG_NAME.findall(message) == []
    assert OPERATOR_HINT.findall(message) == []
    assert REASON_CODE.search(message)
