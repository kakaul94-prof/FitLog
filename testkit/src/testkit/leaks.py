"""Scan a response for things it must never contain.

`find_leaks` returns a readable list of problems (empty means clean), so a
failing test says exactly what leaked: a secret value, a token, a stack trace,
an internal address, or another user's data.
"""

import re
from collections.abc import Iterable, Mapping

# Shapes that have no business in an error or function response, whoever asked.
PATTERNS: dict[str, re.Pattern[str]] = {
    "a JWT": re.compile(r"eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*"),
    "an Anthropic API key": re.compile(r"sk-ant-[\w-]{8,}"),
    "a Python traceback": re.compile(r"Traceback \(most recent call last\)"),
    "a JavaScript stack frame": re.compile(r"\bat \S+ \(?[\w./\\:-]+:\d+:\d+\)?"),
    "a source file path": re.compile(r"/home/|/Users/|[A-Z]:\\\\|node_modules|\.tsx?:\d+"),
    "a database connection string": re.compile(r"postgres(?:ql)?://"),
    "an internal service address": re.compile(r"supabase_\w+_fitlog|kong:8000|:54322\b"),
}


def find_leaks(
    text: str,
    *,
    secrets: Mapping[str, str] | None = None,
    others_data: Iterable[str] = (),
) -> list[str]:
    """Everything in `text` that shouldn't be there.

    secrets:     {label: value} that must never appear verbatim (keys, passwords).
    others_data: values that belong to a different user (ids, emails, food names).
    """
    found = [
        f"{label} ({m.group(0)[:40]!r})" for label, p in PATTERNS.items() if (m := p.search(text))
    ]
    found += [f"the {label}" for label, value in (secrets or {}).items() if value and value in text]
    found += [f"another user's data ({v!r})" for v in others_data if v and v in text]
    return found
