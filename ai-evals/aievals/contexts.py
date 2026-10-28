"""Builds the promptfoo layer's inputs: ai-evals/promptfoo/contexts.json.

    python -m aievals.contexts    # the local stack must be up: make stack-up, then
                                  # source api-tests/scripts/local-env.sh
                                  # (npm run eval:pf:contexts does both steps)

The promptfoo layer (ai-evals/promptfoo) answers every golden case through the
real trainer function, which needs what the browser would post: the user's log
snapshot and their saved memory. The live tier builds those on every run by
seeding a synthetic user into the local stack; a promptfoo run shouldn't need
Docker. So this builds them once, the same way: seed_persona plants the
persona and the case's hostile text exactly as the live tier does, and the
app's own trainerContext.ts builds the snapshot (through the Node harness).
Every date is then made relative, as in the production canary's snapshot.

One entry per persona an unseeded case uses, and one per seeded case. The file
records what it was built from (personas.yaml, trainerContext.ts, each seeded
case's seed), so the promptfoo runner can tell when it is stale. Every user is
synthetic, created in the local stack for this and deleted afterwards.
"""

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from aievals.canary import template_snapshot
from aievals.dataset import DATASET_DIR, ROOT, Case, load_dataset
from aievals.harness import ClientHarness
from aievals.personas import seed_persona, with_seed
from testkit.auth import AdminAuth, AuthClient, SignedInUser
from testkit.config import Settings
from testkit.leaks import find_leaks
from testkit.rest import RestClient
from testkit.users import UserFactory

FIXTURE = ROOT / "promptfoo" / "contexts.json"
SOURCES = {
    "personas.yaml": DATASET_DIR / "personas.yaml",
    "trainerContext.ts": ROOT.parent / "src" / "lib" / "trainerContext.ts",
}


def file_hash(path: Path) -> str:
    """sha256 of a text file with line endings normalised (lib/contexts.mjs fileHash)."""
    text = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def seed_hash(persona: str, seed: dict[str, str]) -> str:
    """What a seeded case's entry is built from (lib/contexts.mjs seedHash)."""
    canonical = json.dumps(
        {"persona": persona, "seed": seed},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def entry_key(case: Case) -> str:
    """The fixture key a case reads its log from (lib/contexts.mjs contextKey)."""
    return f"case:{case.id}" if case.seed else f"persona:{case.persona}"


def _git_sha() -> str:
    git = shutil.which("git")
    if git is None:
        return ""
    done = subprocess.run(  # noqa: S603 (fixed arguments)
        [git, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
    )
    return done.stdout.strip()


def build(today: date) -> dict[str, Any]:
    settings = Settings.from_env()
    dataset = load_dataset()
    ClientHarness.build()
    harness = ClientHarness(settings.supabase_url, settings.anon_key)
    personas = sorted({c.persona for c in dataset.cases if not c.seed})
    seeded = [c for c in dataset.cases if c.seed]
    made: list[tuple[str, Case | None, SignedInUser]] = []
    with httpx.Client(timeout=30) as http:
        users = UserFactory(
            AdminAuth(http, settings.supabase_url, settings.service_role_key),
            AuthClient(http, settings.supabase_url, settings.anon_key),
            "promptfoo",
        )
        try:
            for name in personas:
                user = users.create(f"pf-{name}")
                api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
                seed_persona(api, user.id, dataset.personas[name], today)
                made.append((f"persona:{name}", None, user))
            for case in seeded:
                user = users.create(f"pf-{case.id}")
                api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
                persona = with_seed(dataset.personas[case.persona], case.seed)
                seed_persona(api, user.id, persona, today)
                made.append((entry_key(case), case, user))
            inputs = harness.trainer_inputs([user for _, _, user in made])
        finally:
            users.delete_all()

    entries: dict[str, dict[str, Any]] = {}
    for (key, seeded_case, _), given in zip(made, inputs, strict=True):
        leaks = find_leaks(given.context)
        if leaks:
            sys.exit(f"{key}: the snapshot holds something that must not be committed: {leaks}")
        entry: dict[str, Any] = {
            "context": template_snapshot(given.context, today),
            "memory": given.memory,
        }
        if seeded_case is not None:
            seed: dict[str, str] = {str(k): v for k, v in seeded_case.seed.items()}
            entry["seed_hash"] = seed_hash(seeded_case.persona, seed)
        entries[key] = entry
    return {
        "generated": today.isoformat(),
        "git_sha": _git_sha(),
        "sources": {name: file_hash(path) for name, path in SOURCES.items()},
        "entries": entries,
    }


def main() -> int:
    fixture = build(date.today())
    FIXTURE.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {FIXTURE} ({len(fixture['entries'])} entries).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
