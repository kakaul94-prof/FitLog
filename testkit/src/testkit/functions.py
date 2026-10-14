"""Client for FitLog's Cloudflare Pages Functions (`/api/*`).

Locally they run under `wrangler pages dev` (scripts/start-functions.sh), with
the Claude API swapped for `testkit.anthropic_stub`. Like the other clients,
every call returns the raw `httpx.Response`.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Self

import httpx

Turn = dict[str, str]  # {"role": "user" | "assistant", "content": "..."}


@dataclass(frozen=True)
class TimedReply:
    """A trainer answer read as a stream, with when its first byte and its end arrived."""

    status: int
    text: str
    first_byte_ms: int  # request sent -> first body byte (the end, when the body is empty)
    total_ms: int  # request sent -> whole body read


class FunctionsClient:
    def __init__(self, http: httpx.Client, base_url: str, access_token: str | None = None) -> None:
        self._http = http
        self._base_url = base_url
        self.access_token = access_token

    def as_user(self, access_token: str | None) -> Self:
        """The same client, sending `access_token` as the bearer token (None: signed out)."""
        return type(self)(self._http, self._base_url, access_token)

    def post(
        self,
        name: str,
        body: object = None,
        *,
        content: bytes | None = None,
        timeout: float | None = None,
    ) -> httpx.Response:
        """POST to /api/<name> with a JSON `body`, or raw `content` for malformed-input tests."""
        headers = {"content-type": "application/json"}
        if self.access_token is not None:
            headers["authorization"] = f"Bearer {self.access_token}"
        return self._http.post(
            f"{self._base_url}/api/{name}",
            json=body if content is None else None,
            content=content,
            headers=headers,
            timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
        )

    def ask_trainer(
        self,
        question: str,
        *,
        history: Sequence[Turn] = (),
        context: str = "",
        memory: Sequence[str] = (),
        timeout: float | None = None,
    ) -> httpx.Response:
        """Ask the trainer a question, the way src/lib/trainer.ts does."""
        messages = [*history, {"role": "user", "content": question}]
        return self.post(
            "trainer",
            {"messages": messages, "context": context, "memory": list(memory)},
            timeout=timeout,
        )

    def ask_trainer_timed(
        self,
        question: str,
        *,
        history: Sequence[Turn] = (),
        context: str = "",
        memory: Sequence[str] = (),
        timeout: float | httpx.Timeout | None = None,
    ) -> TimedReply:
        """`ask_trainer`, read as the app reads it (streamed), timed to the first byte and the end.

        The chat streams, so time to first byte is what the user waits before
        text appears, and the total is how long the whole answer takes.
        Transport errors propagate, as with every other call here.
        """
        messages = [*history, {"role": "user", "content": question}]
        headers = {"content-type": "application/json"}
        if self.access_token is not None:
            headers["authorization"] = f"Bearer {self.access_token}"
        start = time.monotonic()
        first: float | None = None
        chunks: list[bytes] = []
        with self._http.stream(
            "POST",
            f"{self._base_url}/api/trainer",
            json={"messages": messages, "context": context, "memory": list(memory)},
            headers=headers,
            timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
        ) as resp:
            for chunk in resp.iter_bytes():
                if chunk and first is None:
                    first = time.monotonic()
                chunks.append(chunk)
            status = resp.status_code
        end = time.monotonic()
        return TimedReply(
            status=status,
            text=b"".join(chunks).decode("utf-8", errors="replace"),
            first_byte_ms=round(((first if first is not None else end) - start) * 1000),
            total_ms=round((end - start) * 1000),
        )
