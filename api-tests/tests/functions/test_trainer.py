"""Ask-a-trainer (/api/trainer), with the Claude API replaced by a recording stub.

The Playwright suite can't see what this function sends to Claude or how it
copes when Claude misbehaves. Here the stub records every outgoing request and
plays back scripted answers (normal streams, API errors, silence, a dropped
connection, garbage, refusals), so both sides of the call are tested without
spending a cent or depending on the network.
"""

import time

import pytest

from testkit.anthropic_stub import AnthropicStub, Reply
from testkit.auth import SignedInUser
from testkit.config import FAKE_ANTHROPIC_KEY
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.models import ClaudeRequest, FunctionError

pytestmark = [pytest.mark.functions, pytest.mark.xdist_group("functions")]

PROMPT_OPENING = "You are the training coach inside FitLog"


@pytest.fixture
def trainer(functions: FunctionsClient, owner: SignedInUser) -> FunctionsClient:
    return functions.as_user(owner.access_token)


def _sent(claude: AnthropicStub) -> ClaudeRequest:
    """The single request the function sent to Claude, validated against its contract."""
    return ClaudeRequest.model_validate(claude.only_call().body)


# -- the happy path ---------------------------------------------------------------------


def test_streams_claudes_answer_back_as_plain_text(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    claude.queue(Reply.stream("Add 5 lb next session and keep the reps at 5."))

    resp = trainer.ask_trainer("How do I add weight to my bench?")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.headers["cache-control"] == "no-store"
    assert resp.text == "Add 5 lb next session and keep the reps at 5."


def test_sends_the_server_side_key_and_sane_model_settings(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.ask_trainer("How many sets should I do?")

    call = claude.only_call()
    sent = ClaudeRequest.model_validate(call.body)
    assert call.path == "/v1/messages"
    assert call.headers["x-api-key"] == FAKE_ANTHROPIC_KEY
    assert call.headers["anthropic-version"] == "2023-06-01"
    assert sent.model.startswith("claude-haiku-")  # the cheap model: ~$0.003 a question
    assert sent.stream is True
    assert 200 <= sent.max_tokens <= 1024  # a runaway-reply backstop, not a length target


def test_system_prompt_carries_the_rules_the_log_and_the_memory(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.ask_trainer(
        "Why has my squat stalled?",
        context="SQUAT: 225 lb x 5 on each of the last 3 sessions",
        memory=["Left knee aches on deep squats", "Trains at home, no cable machine"],
    )

    system = _sent(claude).system or ""
    assert system.startswith(PROMPT_OPENING)
    # The safety rules travel with every question.
    assert "Never tell them to push through pain" in system
    assert "Never state or imply that they are deficient" in system
    # Grounding: the user's own log and the facts saved from earlier chats.
    assert "SQUAT: 225 lb x 5 on each of the last 3 sessions" in system
    assert "- Left knee aches on deep squats\n- Trains at home, no cable machine" in system


def test_without_a_log_snapshot_the_prompt_says_so(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.ask_trainer("Any tips?", context="")

    assert "Their training data is unavailable right now" in (_sent(claude).system or "")


def test_the_conversation_is_passed_in_order(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    history = [
        {"role": "user", "content": "My bench is stuck at 185."},
        {"role": "assistant", "content": "Try a 5x5 at 165 for two weeks."},
    ]

    trainer.ask_trainer("And after that?", history=history)

    messages = [m.model_dump() for m in _sent(claude).messages]
    assert messages == [*history, {"role": "user", "content": "And after that?"}]


# -- input caps: this endpoint is the cost boundary ----------------------------------------


def test_history_is_trimmed_to_the_last_12_turns_starting_with_the_user(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(30)
    ]

    trainer.ask_trainer("latest question", history=history)

    messages = _sent(claude).messages
    assert len(messages) <= 12
    assert messages[0].role == "user"
    assert messages[-1].content == "latest question"


def test_a_long_message_is_cut_to_4000_characters(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.ask_trainer("x" * 10_000)

    assert [len(str(m.content)) for m in _sent(claude).messages] == [4000]


def test_back_to_back_messages_are_merged_but_still_capped(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    """Two user turns in a row are merged into one; the merge must respect the cap too.

    Otherwise the cap is bypassed by splitting a huge prompt across many turns.
    """
    trainer.post(
        "trainer",
        {
            "messages": [{"role": "user", "content": "short"}]
            + [{"role": "user", "content": "y" * 4000}] * 5
        },
    )

    assert all(len(str(m.content)) <= 4000 for m in _sent(claude).messages)


def test_the_log_snapshot_is_cut_to_12000_characters(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.ask_trainer("q", context="c" * 20_000)

    system = _sent(claude).system or ""
    assert "c" * 12_000 in system
    assert "c" * 12_001 not in system


def test_memory_is_capped_at_40_facts_of_300_characters(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    memory = ["L" * 1000] + [f"fact {i}" for i in range(60)]

    trainer.ask_trainer("q", memory=memory)

    system = _sent(claude).system or ""
    facts = [line for line in system.splitlines() if line.startswith("- L") or "- fact " in line]
    assert len(facts) == 40
    assert facts[0] == "- " + "L" * 300


def test_memory_that_is_not_text_is_ignored(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    trainer.post(
        "trainer",
        {
            "messages": [{"role": "user", "content": "q"}],
            "memory": [1, None, {"x": 1}, " ", "Real fact"],
        },
    )

    system = _sent(claude).system or ""
    assert (
        "What you already know about them (saved from past conversations):\n- Real fact\n" in system
    )


# -- bad requests never reach Claude ---------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(b"{not json", id="not-json"),
        pytest.param(b"{}", id="no-messages"),
        pytest.param(b'{"messages": []}', id="empty-conversation"),
        pytest.param(b'{"messages": [{"role": "user", "content": "   "}]}', id="blank-question"),
        pytest.param(b'{"messages": "hello"}', id="messages-not-a-list"),
    ],
)
def test_bad_requests_are_refused_before_calling_claude(
    trainer: FunctionsClient, claude: AnthropicStub, body: bytes
) -> None:
    resp = trainer.post("trainer", content=body)

    assert resp.status_code == 400
    FunctionError.model_validate_json(resp.content)
    assert claude.calls() == []


# -- when Claude misbehaves --------------------------------------------------------------------


# failure -> (what Claude does, the reason code the user is shown). Each code
# maps to a fix in ai-evals/README.md; the secret's name stays in the log.
UPSTREAM_FAILURES: dict[str, tuple[Reply, str]] = {
    "bad-key": (
        Reply.error(401, "authentication_error", "invalid x-api-key"),
        "(code: key)",
    ),
    "no-credit": (
        Reply.error(400, "invalid_request_error", "Your credit balance is too low"),
        "(code: credits)",
    ),
    "rate-limited": (
        Reply.error(429, "rate_limit_error", "Number of requests exceeded"),
        "(code: rate)",
    ),
    "overloaded": (Reply.error(529, "overloaded_error", "Overloaded"), "(code: upstream)"),
    "server-error": (Reply.error(500, "api_error", "Internal server error"), "(code: upstream)"),
    "connection-dropped": (Reply.drop(), "(code: unreachable)"),
}


@pytest.mark.parametrize("failure", UPSTREAM_FAILURES)
def test_upstream_failures_become_one_clear_message_and_nothing_else(
    trainer: FunctionsClient, claude: AnthropicStub, failure: str
) -> None:
    reply, says = UPSTREAM_FAILURES[failure]
    claude.queue(reply)

    resp = trainer.ask_trainer("q")

    assert resp.status_code == 502
    error = FunctionError.model_validate_json(resp.content)  # no `detail`, no `keyShape`
    assert says in error.error
    assert find_leaks(resp.text, secrets={"Claude API key": FAKE_ANTHROPIC_KEY}) == []
    assert "req_stub" not in resp.text, "Claude's request id is an upstream internal"


def test_a_silent_claude_times_out_in_seconds(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    """The local server sets ANTHROPIC_TIMEOUT_MS=2000; production waits longer."""
    claude.queue(Reply.hang(10))

    started = time.monotonic()
    resp = trainer.ask_trainer("q", timeout=15)
    elapsed = time.monotonic() - started

    assert resp.status_code == 504
    assert "took too long" in FunctionError.model_validate_json(resp.content).error
    assert elapsed < 6


def test_a_stream_that_breaks_midway_keeps_the_text_and_says_so(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    claude.queue(Reply.stream_error("Drop the weight to 165 and"))

    resp = trainer.ask_trainer("q")

    assert resp.status_code == 200
    assert resp.text.startswith("Drop")
    assert resp.text.endswith("[The trainer was cut off. Try asking again.]")


def test_a_refusal_gets_a_polite_message_not_an_empty_bubble(
    trainer: FunctionsClient, claude: AnthropicStub
) -> None:
    claude.queue(Reply.refusal())

    resp = trainer.ask_trainer("q")

    assert resp.status_code == 200
    assert resp.text.startswith("I can't help with that one.")


SSE = "text/event-stream"


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param(Reply.raw("<html><body>Bad gateway</body></html>"), id="html-page"),
        pytest.param(Reply.raw("data: {not json}\n\n", content_type=SSE), id="broken-events"),
        pytest.param(Reply.raw("", content_type=SSE), id="empty-stream"),
    ],
)
def test_an_answer_with_no_usable_text_is_not_shown_as_an_empty_bubble(
    trainer: FunctionsClient, claude: AnthropicStub, reply: Reply
) -> None:
    claude.queue(reply)

    resp = trainer.ask_trainer("q")

    assert resp.text.strip(), "the user would see an empty answer"
    assert "<html" not in resp.text


# -- who may call it ---------------------------------------------------------------------------


def test_signed_out_callers_are_refused_before_calling_claude(
    functions: FunctionsClient, claude: AnthropicStub
) -> None:
    resp = functions.ask_trainer("Free advice please")

    assert resp.status_code == 401
    FunctionError.model_validate_json(resp.content)
    assert claude.calls() == []
