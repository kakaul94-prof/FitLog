"""The app's own trainer client code, run under Node (see ai-evals/harness/client.ts).

The evals never re-implement what the browser does. To know what the trainer is
sent, they run src/lib/trainerContext.ts; to know which "Remember" chip a reply
would offer, they run src/lib/trainer.ts. Both execute in Node against the
local test stack, driven over stdin/stdout.
"""

import json
import os
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from aievals.dataset import ROOT
from testkit.auth import SignedInUser

BUILD_SCRIPT = ROOT / "harness" / "build.mjs"
BUNDLE = ROOT / "harness" / "dist" / "client.mjs"

# Pages Functions the harness can run directly with a chosen environment.
PagesFunction = Literal["middleware", "trainer"]


@dataclass(frozen=True)
class TrainerInput:
    """What the browser posts to /api/trainer for one user, besides the question."""

    context: str
    memory: list[str]


@dataclass(frozen=True)
class ParsedReply:
    """A reply as the app shows it."""

    raw: str  # the streamed text, memory marker and all
    text: str  # what the chat bubble shows
    remember: str | None  # the fact offered on a "Remember" chip, if any


@dataclass(frozen=True)
class FunctionResult:
    status: int
    body: str


class HarnessError(RuntimeError):
    pass


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        raise HarnessError("Node.js is not on PATH; the harness runs the app's own TS code")
    return node


class ClientHarness:
    def __init__(self, supabase_url: str, anon_key: str) -> None:
        self._env = {**os.environ, "SUPABASE_URL": supabase_url, "SUPABASE_ANON_KEY": anon_key}

    @staticmethod
    def build() -> None:
        """Bundle the harness (about a second); run once per test session."""
        subprocess.run([_node(), str(BUILD_SCRIPT)], check=True)  # noqa: S603 (fixed args)

    def trainer_inputs(self, users: Sequence[SignedInUser]) -> list[TrainerInput]:
        """Each user's snapshot and saved memory, built exactly as TrainerChat.tsx does."""
        creds = [{"email": u.email, "password": u.password} for u in users]
        return [TrainerInput(**r) for r in self._run({"command": "context", "users": creds})]

    def trainer_input(self, user: SignedInUser) -> TrainerInput:
        return self.trainer_inputs([user])[0]

    def parse(self, replies: Sequence[str]) -> list[ParsedReply]:
        """What the bubble shows and which chip is offered, per the app's parser."""
        parsed = self._run({"command": "parse", "replies": list(replies)})
        return [ParsedReply(raw=raw, **p) for raw, p in zip(replies, parsed, strict=True)]

    def parse_one(self, reply: str) -> ParsedReply:
        return self.parse([reply])[0]

    def call_function(
        self, function: PagesFunction, env: dict[str, str], body: object
    ) -> FunctionResult:
        """Run a Pages Function with exactly `env`, e.g. a deploy missing a secret."""
        request = {"command": "call", "function": function, "env": env, "body": body}
        return FunctionResult(**self._run(request))

    def _run(self, request: dict[str, Any]) -> Any:  # noqa: ANN401 (JSON from the harness)
        if not BUNDLE.exists():
            self.build()
        done = subprocess.run(  # noqa: S603 (fixed executable, JSON on stdin)
            [_node(), str(BUNDLE)],
            input=json.dumps(request),
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=self._env,
            timeout=120,
            check=False,
        )
        if done.returncode != 0:
            raise HarnessError(f"harness failed: {done.stderr.strip()[:500]}")
        return json.loads(done.stdout)
