"""A recording, budget-capped pass-through to the real Claude API (live tier only).

The local functions server is pointed at this proxy (ANTHROPIC_BASE_URL) and
given a placeholder key, so the live tier exercises the real function, prompt
and streaming path while the proxy:
- swaps in the real key, which lives only in this process: never in wrangler's
  command line, its environment or its logs;
- refuses every call past the run's budget, so no bug can spend past the cap;
- records what each call cost (usage from the stream itself, never estimated)
  and which model actually answered.
"""

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import TracebackType
from typing import Any, Self

import httpx

from aievals.pricing import Usage

ANTHROPIC = "https://api.anthropic.com"


@dataclass(frozen=True)
class ProxiedCall:
    question: str  # the last user turn, which says which case this call answered
    system: str  # the system prompt the function built
    status: int
    model: str = ""  # the model that answered, from the stream ("" if it never started)
    stop_reason: str = ""
    usage: Usage = field(default_factory=Usage)


class StreamMeter:
    """Reads model, usage and stop reason out of an Anthropic SSE stream as it passes."""

    def __init__(self) -> None:
        self._buffer = ""
        self.model = ""
        self.stop_reason = ""
        self.input_tokens = 0
        self.output_tokens = 0

    def feed(self, chunk: bytes) -> None:
        self._buffer += chunk.decode("utf-8", errors="replace")
        *events, self._buffer = self._buffer.split("\n\n")
        for event in events:
            for line in event.splitlines():
                if line.startswith("data:"):
                    self._read(line[5:].strip())

    def _read(self, payload: str) -> None:
        try:
            data: dict[str, Any] = json.loads(payload)
        except ValueError:
            return
        if data.get("type") == "message_start":
            message = data.get("message", {})
            self.model = message.get("model", "")
            usage = message.get("usage", {})
            self.input_tokens = sum(
                usage.get(k) or 0
                for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
            )
        elif data.get("type") == "message_delta":
            self.output_tokens = data.get("usage", {}).get("output_tokens", self.output_tokens)
            self.stop_reason = data.get("delta", {}).get("stop_reason") or self.stop_reason

    @property
    def usage(self) -> Usage:
        return Usage(self.input_tokens, self.output_tokens)


class ClaudeProxy:
    """Use as a context manager; `url` is what the functions server points at."""

    def __init__(
        self, api_key: str, max_calls: int, *, port: int = 8791, upstream: str = ANTHROPIC
    ) -> None:
        self._key = api_key
        self._max_calls = max_calls
        self._upstream = upstream.rstrip("/")
        self._lock = threading.Lock()
        self._admitted = 0
        self._calls: list[ProxiedCall] = []
        self.refused = 0
        self._http = httpx.Client(timeout=httpx.Timeout(90, connect=10))
        handler = type("Handler", (_Handler,), {"proxy": self})
        self._server = ThreadingHTTPServer(("127.0.0.1", port), handler)
        self._server.daemon_threads = True
        self.url = f"http://127.0.0.1:{port}"

    @property
    def calls(self) -> list[ProxiedCall]:
        with self._lock:
            return list(self._calls)

    def __enter__(self) -> Self:
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._http.close()

    def _admit(self) -> bool:
        with self._lock:
            if self._admitted >= self._max_calls:
                self.refused += 1
                return False
            self._admitted += 1
            return True

    def _record(self, call: ProxiedCall) -> None:
        with self._lock:
            self._calls.append(call)


class _Handler(BaseHTTPRequestHandler):
    proxy: ClaudeProxy  # set on the subclass ClaudeProxy makes

    def do_POST(self) -> None:
        if self.path != "/v1/messages":
            self._send_json(404, {"type": "error", "error": {"type": "not_found_error"}})
            return
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if not self.proxy._admit():
            # Shaped like the API's own error, so the function handles it as one.
            # A 400, not a 429: retrying a spent budget would only be refused again.
            self._send_json(
                400,
                {
                    "type": "error",
                    "error": {
                        "type": "invalid_request_error",
                        "message": "the eval run's call budget is spent",
                    },
                },
            )
            return
        request = json.loads(body)
        messages = request.get("messages") or [{}]
        question = str(messages[-1].get("content", ""))
        meter, status = StreamMeter(), 0
        try:
            with self.proxy._http.stream(
                "POST",
                f"{self.proxy._upstream}/v1/messages",
                content=body,
                headers={
                    "x-api-key": self.proxy._key,
                    "anthropic-version": self.headers.get("anthropic-version", "2023-06-01"),
                    "content-type": "application/json",
                },
            ) as resp:
                status = resp.status_code
                self.send_response(status)
                self.send_header("content-type", resp.headers.get("content-type", ""))
                self.end_headers()
                for chunk in resp.iter_bytes():
                    meter.feed(chunk)
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except httpx.HTTPError as e:
            if status == 0:  # nothing sent yet: answer as an unreachable upstream would
                status = 502
                self._send_json(
                    502,
                    {
                        "type": "error",
                        "error": {
                            "type": "api_error",
                            "message": f"proxy: {type(e).__name__}",
                        },
                    },
                )
        except (BrokenPipeError, ConnectionResetError):
            pass  # the function gave up first; still record what was spent
        self.proxy._record(
            ProxiedCall(
                question=question,
                system=str(request.get("system", "")),
                status=status,
                model=meter.model,
                stop_reason=meter.stop_reason,
                usage=meter.usage,
            )
        )

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        pass
