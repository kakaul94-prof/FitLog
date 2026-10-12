"""A recording stand-in for the Anthropic Messages API.

The Pages Functions read `ANTHROPIC_BASE_URL` (unset in production), so the
local functions server can be pointed here instead of api.anthropic.com
(scripts/start-functions.sh does this). The stub records every request it gets
and answers with whatever reply a test queued, so a test can check both what a
function *sends* to Claude and how it *handles* each kind of answer.

    python -m testkit.anthropic_stub --port 8790

Control endpoints, wrapped by `AnthropicStub`:
    POST   /__stub/replies   queue the reply for the next /v1/messages call
    GET    /__stub/calls     every /v1/messages request so far, oldest first
    DELETE /__stub/calls     forget recorded calls and queued replies

With no reply queued, /v1/messages streams a short canned answer.
"""

import argparse
import contextlib
import json
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Literal

import httpx

ReplyKind = Literal[
    "stream", "message", "error", "raw", "hang", "drop", "stream_error", "refusal",
    "stall", "max_tokens", "cut",
]  # fmt: skip


@dataclass(frozen=True)
class Reply:
    """One scripted answer from the fake Claude API. Build it with the class methods."""

    kind: ReplyKind
    text: str = ""
    status: int = 200
    error_type: str = ""
    body: str = ""
    content_type: str = "application/json"
    delay_s: float = 0.0

    @classmethod
    def stream(cls, text: str) -> "Reply":
        """A normal streamed (SSE) answer, as the trainer asks for."""
        return cls("stream", text=text)

    @classmethod
    def message(cls, text: str) -> "Reply":
        """A normal non-streamed answer whose first text block is `text`."""
        return cls("message", text=text)

    @classmethod
    def error(cls, status: int, error_type: str, message: str) -> "Reply":
        """An API error in Anthropic's shape, e.g. (429, "rate_limit_error", ...)."""
        return cls("error", status=status, error_type=error_type, text=message)

    @classmethod
    def raw(cls, body: str, *, status: int = 200, content_type: str = "text/html") -> "Reply":
        """Anything at all, for malformed-response tests."""
        return cls("raw", status=status, body=body, content_type=content_type)

    @classmethod
    def hang(cls, seconds: float) -> "Reply":
        """Say nothing for `seconds`, then answer normally (for timeout tests)."""
        return cls("hang", delay_s=seconds, text="Too late.")

    @classmethod
    def drop(cls) -> "Reply":
        """Close the connection without answering (Claude unreachable mid-request)."""
        return cls("drop")

    @classmethod
    def stream_error(cls, text_before: str) -> "Reply":
        """A stream that starts fine, then fails mid-answer with an `error` event."""
        return cls("stream_error", text=text_before)

    @classmethod
    def refusal(cls) -> "Reply":
        """A successful stream with no text and stop_reason "refusal"."""
        return cls("refusal")

    @classmethod
    def stall(cls, text_before: str, seconds: float) -> "Reply":
        """A stream that starts, sends `text_before`, then goes silent for `seconds`."""
        return cls("stall", text=text_before, delay_s=seconds)

    @classmethod
    def max_tokens(cls, text: str) -> "Reply":
        """A complete stream that stopped at the max_tokens ceiling, mid-sentence."""
        return cls("max_tokens", text=text)

    @classmethod
    def cut(cls, text_before: str) -> "Reply":
        """A stream whose connection closes mid-answer, with no error event."""
        return cls("cut", text=text_before)


DEFAULT_REPLY = Reply.stream("Stub reply.")


@dataclass(frozen=True)
class RecordedCall:
    """One request a function sent to the fake Claude API."""

    path: str
    headers: dict[str, str]  # lower-cased names
    body: dict[str, Any] = field(default_factory=dict)


# -- the server ------------------------------------------------------------------------


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.replies: deque[Reply] = deque()
        self.calls: list[RecordedCall] = []


class _Handler(BaseHTTPRequestHandler):
    state: _State  # set on the subclass made by `serve`

    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path == "/__stub/replies":
            with self.state.lock:
                self.state.replies.append(Reply(**json.loads(raw)))
            self._send(204)
        elif self.path == "/v1/messages":
            self._answer(raw)
        else:
            self._send(404)

    def do_GET(self) -> None:
        if self.path == "/__stub/calls":
            with self.state.lock:
                calls = [asdict(c) for c in self.state.calls]
            self._send(200, json.dumps(calls).encode())
        else:
            self._send(404)

    def do_DELETE(self) -> None:
        if self.path == "/__stub/calls":
            with self.state.lock:
                self.state.calls.clear()
                self.state.replies.clear()
            self._send(204)
        else:
            self._send(404)

    def _answer(self, raw: bytes) -> None:
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"unparsed": raw.decode(errors="replace")}
        call = RecordedCall(
            path=self.path, headers={k.lower(): v for k, v in self.headers.items()}, body=body
        )
        with self.state.lock:
            self.state.calls.append(call)
            reply = self.state.replies.popleft() if self.state.replies else DEFAULT_REPLY
        # The function may give up first (the timeout tests): exactly what's being tested.
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self._play(reply, model=str(body.get("model", "")))

    def _play(self, reply: Reply, *, model: str) -> None:
        match reply.kind:
            case "drop":
                self.close_connection = True  # no status line, no body: a dead socket
            case "hang":
                time.sleep(reply.delay_s)
                self._send_events(_text_events(reply.text, model))
            case "stream":
                self._send_events(_text_events(reply.text, model))
            case "stream_error":
                events = _text_events(reply.text, model)[:3]  # start + first delta
                self._send_events([*events, _error_event("overloaded_error", "Overloaded")])
            case "refusal":
                self._send_events(_text_events("", model, stop_reason="refusal"))
            case "max_tokens":
                self._send_events(_text_events(reply.text, model, stop_reason="max_tokens"))
            case "stall" | "cut":
                # The start and the text, but no stop events: the answer never finishes.
                # "stall" then holds the connection open; "cut" closes it at once.
                self._send_events(_text_events(reply.text, model)[:-3])
                time.sleep(reply.delay_s)
            case "message":
                self._send(200, json.dumps(_message(reply.text, model)).encode())
            case "error":
                error = {
                    "type": "error",
                    "error": {"type": reply.error_type, "message": reply.text},
                }
                self._send(reply.status, json.dumps(error).encode(), request_id=True)
            case "raw":
                self._send(reply.status, reply.body.encode(), content_type=reply.content_type)

    def _send(
        self,
        status: int,
        payload: bytes = b"",
        *,
        content_type: str = "application/json",
        request_id: bool = False,
    ) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        if request_id:
            self.send_header("request-id", "req_stub_0123456789")
        self.end_headers()
        self.wfile.write(payload)

    def _send_events(self, events: list[tuple[str, dict[str, Any]]]) -> None:
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for name, data in events:
            self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()
            time.sleep(0.005)  # real chunks arrive apart; make the function stream them

    def log_message(self, format: str, *args: object) -> None:
        pass  # keep the functions server's log readable


def _text_events(
    text: str, model: str, *, stop_reason: str = "end_turn"
) -> list[tuple[str, dict[str, Any]]]:
    words = text.split(" ")
    deltas = [w if i == len(words) - 1 else f"{w} " for i, w in enumerate(words) if text]
    start = {"type": "message_start", "message": {**_message("", model), "content": []}}
    return [
        ("message_start", start),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        *[
            ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                     "delta": {"type": "text_delta", "text": d}})
            for d in deltas
        ],
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "usage": {"output_tokens": len(deltas)},
                           "delta": {"stop_reason": stop_reason, "stop_sequence": None}}),
        ("message_stop", {"type": "message_stop"}),
    ]  # fmt: skip


def _error_event(error_type: str, message: str) -> tuple[str, dict[str, Any]]:
    return ("error", {"type": "error", "error": {"type": error_type, "message": message}})


def _message(text: str, model: str) -> dict[str, Any]:
    return {
        "id": "msg_stub",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def serve(port: int, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    """A stub server bound to `host:port` (call `serve_forever()` on it)."""
    handler = type("Handler", (_Handler,), {"state": _State()})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


# -- the control client used by tests --------------------------------------------------


class AnthropicStub:
    """Scripts the stub's replies and reads back what functions sent it."""

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._url = base_url

    def queue(self, *replies: Reply) -> None:
        """The next calls to /v1/messages get these replies, in order."""
        for reply in replies:
            self._http.post(f"{self._url}/__stub/replies", json=asdict(reply)).raise_for_status()

    def calls(self) -> list[RecordedCall]:
        resp = self._http.get(f"{self._url}/__stub/calls")
        resp.raise_for_status()
        return [RecordedCall(**c) for c in resp.json()]

    def only_call(self) -> RecordedCall:
        """The single call made since the last reset (fails if there were more or none)."""
        calls = self.calls()
        assert len(calls) == 1, f"expected exactly one call to Claude, got {len(calls)}"
        return calls[0]

    def reset(self) -> None:
        self._http.delete(f"{self._url}/__stub/calls").raise_for_status()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8790)
    port = parser.parse_args().port
    print(f"anthropic stub listening on http://127.0.0.1:{port}", flush=True)
    serve(port).serve_forever()
