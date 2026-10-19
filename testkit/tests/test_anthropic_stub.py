"""The recording Claude stub, run for real on a free local port."""

import json
import threading
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from testkit.anthropic_stub import AnthropicStub, Reply, serve
from testkit.config import FAKE_ANTHROPIC_KEY

REQUEST = {
    "model": "claude-test",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Hi"}],
}


@pytest.fixture
def stub_url() -> Iterator[str]:
    server = serve(0)  # port 0: the OS picks a free one
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


@pytest.fixture
def http() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=5) as client:
        yield client


def ask(http: httpx.Client, stub_url: str) -> httpx.Response:
    """What a Pages Function does: POST /v1/messages with the API key."""
    return http.post(f"{stub_url}/v1/messages", json=REQUEST, headers={"x-api-key": "k"})


def events(resp: httpx.Response) -> list[tuple[str, dict[str, Any]]]:
    parsed = []
    for block in resp.text.strip().split("\n\n"):
        name, data = (line.split(": ", 1)[1] for line in block.splitlines())
        parsed.append((name, json.loads(data)))
    return parsed


def streamed_text(resp: httpx.Response) -> str:
    return "".join(d["delta"]["text"] for n, d in events(resp) if n == "content_block_delta")


def test_records_every_request_a_function_sends(http: httpx.Client, stub_url: str) -> None:
    stub = AnthropicStub(http, stub_url)
    http.post(f"{stub_url}/v1/messages", json=REQUEST, headers={"x-api-key": FAKE_ANTHROPIC_KEY})
    call = stub.only_call()
    assert (call.path, call.body) == ("/v1/messages", REQUEST)
    assert call.headers["x-api-key"] == FAKE_ANTHROPIC_KEY  # header names lower-cased


def test_plays_queued_replies_in_order_then_a_default_stream(
    http: httpx.Client, stub_url: str
) -> None:
    AnthropicStub(http, stub_url).queue(
        Reply.message("First."), Reply.error(429, "rate_limit_error", "Slow down")
    )
    first, second, third = (ask(http, stub_url) for _ in range(3))
    assert first.json()["content"][0]["text"] == "First."
    assert first.json()["model"] == "claude-test"
    assert second.status_code == 429
    assert second.json()["error"] == {"type": "rate_limit_error", "message": "Slow down"}
    assert second.headers["request-id"]  # real errors carry one; functions must not leak it
    assert streamed_text(third) == "Stub reply."


def test_a_stream_arrives_as_text_deltas_and_ends_cleanly(
    http: httpx.Client, stub_url: str
) -> None:
    AnthropicStub(http, stub_url).queue(Reply.stream("Drive through your heels."))
    resp = ask(http, stub_url)
    assert resp.headers["content-type"] == "text/event-stream"
    assert streamed_text(resp) == "Drive through your heels."
    names = [name for name, _ in events(resp)]
    assert (names[0], names[-1]) == ("message_start", "message_stop")


def test_failure_replies_look_like_the_real_failures(http: httpx.Client, stub_url: str) -> None:
    AnthropicStub(http, stub_url).queue(
        Reply.refusal(), Reply.stream_error("Half an"), Reply.raw("<h1>502</h1>", status=502)
    )
    refusal, cut, proxy_page = (ask(http, stub_url) for _ in range(3))
    stop = next(d for n, d in events(refusal) if n == "message_delta")["delta"]["stop_reason"]
    assert (streamed_text(refusal), stop) == ("", "refusal")
    assert events(cut)[-1][0] == "error"
    assert (proxy_page.status_code, proxy_page.text) == (502, "<h1>502</h1>")


def test_reset_forgets_calls_and_queued_replies(http: httpx.Client, stub_url: str) -> None:
    stub = AnthropicStub(http, stub_url)
    ask(http, stub_url)
    stub.queue(Reply.message("never played"))
    stub.reset()
    assert stub.calls() == []
    assert streamed_text(ask(http, stub_url)) == "Stub reply."


def test_only_call_fails_unless_there_was_exactly_one(http: httpx.Client, stub_url: str) -> None:
    stub = AnthropicStub(http, stub_url)
    with pytest.raises(AssertionError, match="got 0"):
        stub.only_call()
    ask(http, stub_url)
    ask(http, stub_url)
    with pytest.raises(AssertionError, match="got 2"):
        stub.only_call()


def test_max_recorded_keeps_only_the_newest_calls(http: httpx.Client) -> None:
    """--max-recorded N (the load tests use it): memory stays flat over a long run."""
    server = serve(0, max_recorded=2)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        for n in range(3):
            http.post(
                f"{url}/v1/messages", json={**REQUEST, "max_tokens": n}, headers={"x-api-key": "k"}
            )
        calls = AnthropicStub(http, url).calls()
        assert [c.body["max_tokens"] for c in calls] == [1, 2]  # the first one was dropped
    finally:
        server.shutdown()
        server.server_close()
