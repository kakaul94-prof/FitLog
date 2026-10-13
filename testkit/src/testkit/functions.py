"""Client for FitLog's Cloudflare Pages Functions (`/api/*`).

Locally they run under `wrangler pages dev` (scripts/start-functions.sh), with
the Claude API swapped for `testkit.anthropic_stub`. Like the other clients,
every call returns the raw `httpx.Response`.
"""

from collections.abc import Sequence
from typing import Self

import httpx

Turn = dict[str, str]  # {"role": "user" | "assistant", "content": "..."}


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
