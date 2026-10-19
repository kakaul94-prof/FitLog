"""Latency: percentiles, and a per-category report against each category's p95 budget.

Shared by the live tier (where the budgets are reported, never gated) and the
production canary (where a category over its budget raises an infrastructure
alert). Nearest-rank percentiles: with three answers in a category the p95 is
the slowest one, which is what a budget on a small sample should mean (one slow
answer in three is a slow answer in three). Milliseconds, rounded, so the
dashboard can chart them as they are.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Sample:
    """One answered call: its category, the whole answer's time, the first byte's."""

    category: str
    total_ms: float
    first_byte_ms: float


def percentile(values: Sequence[float], p: float) -> float | None:
    """The nearest-rank `p`th percentile (0-100) of `values`, or None when empty."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def summarize_ms(samples: Sequence[float]) -> dict[str, Any] | None:
    """p50, p95 and max of `samples` (milliseconds), or None when nothing was measured."""
    p50, p95 = percentile(samples, 50), percentile(samples, 95)
    if p50 is None or p95 is None:
        return None
    return {
        "samples": len(samples),
        "p50_ms": round(p50),
        "p95_ms": round(p95),
        "max_ms": round(max(samples)),
    }


def report(samples: Sequence[Sample], budgets: Mapping[str, int]) -> dict[str, Any] | None:
    """Overall and per-category latency, each category held to its p95 budget.

    `over_budget` lists the categories whose p95 (whole answer) is over budget;
    `ok` is true when there are none. A category with no budget is reported and
    is never over.
    """
    overall = summarize_ms([s.total_ms for s in samples])
    if overall is None:
        return None
    first = summarize_ms([s.first_byte_ms for s in samples]) or {}
    categories: dict[str, dict[str, Any]] = {}
    for category in sorted({s.category for s in samples}):
        mine = summarize_ms([s.total_ms for s in samples if s.category == category]) or {}
        budget = budgets.get(category)
        categories[category] = {
            **mine,
            "budget_p95_ms": budget,
            "ok": budget is None or mine["p95_ms"] <= budget,
        }
    over = [c for c, m in categories.items() if not m["ok"]]
    return {
        **overall,
        "first_byte_p50_ms": first.get("p50_ms"),
        "first_byte_p95_ms": first.get("p95_ms"),
        "categories": categories,
        "over_budget": over,
        "ok": not over,
    }
