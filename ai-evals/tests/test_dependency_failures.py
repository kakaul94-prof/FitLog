"""Dependency failure: Claude slow, down, rate-limited or answering garbage.

Each failure is provoked once, followed by an ordinary question, and the outcome
is checked for four properties:
- it fails safely: a clear JSON error, or a non-empty answer, never a blank bubble;
- it leaks nothing: no key, token, upstream request id, stack trace or HTML page;
- it answers within seconds, even when Claude goes quiet mid-answer;
- the next question still works.
An answer that stops partway must also say it was cut off, so a half-sentence is
never mistaken for the whole advice.

The local functions server runs with ANTHROPIC_TIMEOUT_MS=2000 (production waits
longer), so every bound here is a few seconds.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from aievals.harness import TrainerInput
from aievals.personas import PersonaUser
from testkit.anthropic_stub import AnthropicStub, Reply
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.models import FunctionError

pytestmark = pytest.mark.functions

PARTIAL = "Drop the weight to 205 lb and"
RECOVERED = "Recovered: add 5 lb next session."
SSE = "text/event-stream"

FAILURES: dict[str, Reply] = {
    # Before the answer starts: the function answers with a JSON error.
    "slow-to-start": Reply.hang(10),
    "rate-limited-429": Reply.error(429, "rate_limit_error", "Number of requests exceeded"),
    "server-error-500": Reply.error(500, "api_error", "Internal server error"),
    "unavailable-503": Reply.error(503, "api_error", "Service unavailable"),
    "overloaded-529": Reply.error(529, "overloaded_error", "Overloaded"),
    "bad-key-401": Reply.error(401, "authentication_error", "invalid x-api-key"),
    "no-credit-400": Reply.error(400, "invalid_request_error", "Your credit balance is too low"),
    "spend-limit-400": Reply.error(
        400,
        "invalid_request_error",
        "You have reached your specified workspace API usage limits. "
        "You will regain access on 2026-11-01 at 00:00 UTC.",
    ),
    "connection-dropped": Reply.drop(),
    # A "successful" answer with nothing usable in it.
    "html-error-page": Reply.raw("<html><body>502 Bad Gateway</body></html>"),
    "garbled-stream": Reply.raw("data: {not json}\n\ndata: [DONE]\n\n", content_type=SSE),
    "empty-stream": Reply.raw("", content_type=SSE),
    "json-not-a-stream": Reply.message("A whole answer, but not streamed."),
    "refusal": Reply.refusal(),
    # Answers that stop partway.
    "error-mid-answer": Reply.stream_error(PARTIAL),
    "stall-mid-answer": Reply.stall(PARTIAL, seconds=10),
    "connection-cut-mid-answer": Reply.cut(PARTIAL),
    "max-tokens-cutoff": Reply.max_tokens(PARTIAL),
}
CUT_SHORT = (
    "error-mid-answer",
    "stall-mid-answer",
    "connection-cut-mid-answer",
    "max-tokens-cutoff",
)


@dataclass(frozen=True)
class Outcome:
    status: int
    content_type: str
    body: str
    seconds: float
    next_status: int
    next_body: str


Provoke = Callable[[str], Outcome]


@pytest.fixture(scope="module")
def provoke(stub: AnthropicStub, trainer: FunctionsClient, sam_input: TrainerInput) -> Provoke:
    """provoke(failure) -> what the user saw, then what the next question got (cached)."""
    seen: dict[str, Outcome] = {}

    def ask() -> tuple[int, str, str, float]:
        start = time.monotonic()
        resp = trainer.ask_trainer(
            "How's my squat?", context=sam_input.context, memory=sam_input.memory, timeout=40
        )
        return (
            resp.status_code,
            resp.headers.get("content-type", ""),
            resp.text,
            time.monotonic() - start,
        )

    def run(failure: str) -> Outcome:
        if failure not in seen:
            stub.reset()
            stub.queue(FAILURES[failure], Reply.stream(RECOVERED))
            status, content_type, body, seconds = ask()
            next_status, _, next_body, _ = ask()
            seen[failure] = Outcome(status, content_type, body, seconds, next_status, next_body)
        return seen[failure]

    return run


@pytest.mark.parametrize("failure", FAILURES)
def test_it_fails_safely(provoke: Provoke, failure: str) -> None:
    seen = provoke(failure)

    if seen.status == 200:
        assert seen.content_type.startswith("text/plain")
        assert seen.body.strip(), "the user would see an empty answer"
    else:
        assert seen.status in (502, 504)
        assert FunctionError.model_validate_json(seen.body).error  # one message, nothing else


@pytest.mark.parametrize("failure", FAILURES)
def test_it_leaks_nothing(
    provoke: Provoke, failure: str, sam: PersonaUser, server_secrets: dict[str, str]
) -> None:
    seen = provoke(failure)
    secrets = server_secrets | {"caller's session token": sam.user.access_token}

    assert find_leaks(seen.body, secrets=secrets) == []
    assert "req_stub" not in seen.body, "Claude's request id is an upstream internal"
    assert "<html" not in seen.body.lower()


@pytest.mark.parametrize("failure", FAILURES)
def test_it_answers_within_seconds(provoke: Provoke, failure: str) -> None:
    assert provoke(failure).seconds < 8


@pytest.mark.parametrize("failure", FAILURES)
def test_the_next_question_still_works(provoke: Provoke, failure: str) -> None:
    seen = provoke(failure)

    assert (seen.next_status, seen.next_body) == (200, RECOVERED)


@pytest.mark.parametrize("failure", CUT_SHORT)
def test_an_answer_that_stops_partway_says_so(provoke: Provoke, failure: str) -> None:
    seen = provoke(failure)

    # The stand-in sends all of PARTIAL, except mid-answer errors, which come after one word.
    assert seen.body.startswith("Drop"), "the text that did arrive should be kept"
    assert "cut off" in seen.body.lower(), f"ends silently: {seen.body!r}"


@pytest.mark.parametrize("failure", ["no-credit-400", "spend-limit-400"])
def test_an_account_that_cannot_pay_says_so_with_its_own_code(
    trainer: FunctionsClient, claude: AnthropicStub, sam_input: TrainerInput, failure: str
) -> None:
    """Found live: a workspace spend limit read as a generic `unavailable`.

    The live tier then retried every call instead of stopping, and the person
    asking was told nothing they could act on. Out of credit and over a spend
    limit are the same to the caller: the account needs attention.
    """
    claude.queue(FAILURES[failure])

    resp = trainer.ask_trainer("q", context=sam_input.context, memory=sam_input.memory)

    assert resp.status_code == 502
    assert resp.json()["error"].endswith("(code: credits)")
