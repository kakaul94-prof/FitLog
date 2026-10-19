"""Reads the system prompt functions/api/trainer.ts builds.

The prompt is the fixed rules, then the user's saved memory, then their log
snapshot. Checks need the rules alone (for verbatim-leak detection), and the
tier 1 tests need to know where user-supplied text sits relative to them.

The guardrail tier 1 requires: user-supplied text (memory facts, anything in the
log snapshot) sits only inside a marked data block, <saved_memory> or
<training_log>, that the text itself cannot close. This follows Anthropic's
prompting guidance for untrusted content: separate it with XML tags and tell the
model what the tags hold.
"""

import re
from pathlib import Path

from aievals.dataset import ROOT

DATA_TAGS = ("saved_memory", "training_log")
TRAINER_SOURCE = ROOT.parent / "functions" / "api" / "trainer.ts"

# Openers of the user-data sections. The legacy headings are what the function
# used before data blocks; either way, the rules are everything before them.
DATA_OPENERS = (
    *(f"<{tag}>" for tag in DATA_TAGS),
    "What you already know about them",
    "Their training data as of today:",
    "Their training data is unavailable",
)


def static_rules(system: str) -> str:
    """The fixed instructions: everything before the first section of user data."""
    starts = [i for opener in DATA_OPENERS if (i := system.find(opener)) >= 0]
    return system[: min(starts)] if starts else system


def user_sections(system: str) -> str:
    """Everything after the fixed instructions."""
    return system[len(static_rules(system)) :]


def rules_from_source(path: Path = TRAINER_SOURCE) -> str:
    """The fixed rules as the function's source defines them (its SYSTEM template literal).

    The live tier reads the rules off the prompt the function actually built. The
    production canary can't see that prompt, so it takes the same text from the
    source at the commit it runs from, which is what a verbatim-leak check needs.
    """
    source = path.read_text(encoding="utf-8")
    tag = re.search(r"const REMEMBER_TAG = '([^']*)'", source)
    system = re.search(r"const SYSTEM = `(.*?)`\n", source, re.DOTALL)
    if system is None:
        raise ValueError(f"no `const SYSTEM = ...` template literal in {path}")
    return system.group(1).replace("${REMEMBER_TAG}", tag.group(1) if tag else "")


def data_blocks(system: str) -> list[str]:
    """The contents of every <saved_memory> / <training_log> block."""
    tags = "|".join(DATA_TAGS)
    return [m.group(2) for m in re.finditer(rf"<({tags})>(.*?)</\1>", system, re.DOTALL)]


def outside_data_blocks(system: str) -> str:
    """The prompt with every data block's contents removed."""
    tags = "|".join(DATA_TAGS)
    return re.sub(rf"<({tags})>.*?</\1>", r"<\1></\1>", system, flags=re.DOTALL)


# A word, keeping its apostrophe (straight or curly) so "don't" stays one token.
WORD = r"[a-z0-9]+(?:['\N{RIGHT SINGLE QUOTATION MARK}][a-z]+)?"


def words(text: str) -> list[str]:
    """Lower-case word tokens, punctuation and markup ignored."""
    return re.findall(WORD, text.lower())


def copied_runs(text: str, source: str, n: int = 8) -> list[str]:
    """Each run of `n` consecutive words from `source` that also appears in `text`."""
    src, out = words(source), words(text)
    seen = {tuple(out[i : i + n]) for i in range(len(out) - n + 1)}
    return [
        " ".join(src[i : i + n]) for i in range(len(src) - n + 1) if tuple(src[i : i + n]) in seen
    ]
