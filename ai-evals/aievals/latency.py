"""Latency percentiles, computed the same way for the live tier and the production canary.

Nearest-rank percentiles: with ten answers the p95 is the slowest one, which is
what a budget on a small sample should mean (one slow answer in ten is a slow
answer in ten). Milliseconds, rounded, so the dashboard can chart them as they
are.
"""

import math
from collections.abc import Sequence
from typing import Any


def percentile(values: Sequence[float], p: float) -> float | None:
    """The nearest-rank `p`th percentile (0-100) of `values`, or None when empty."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def summarize_ms(samples: Sequence[float]) -> dict[str, Any] | None:
    """p50, p95 and max of `samples` (milliseconds), or None when nothing was measured."""
    if not samples:
        return None
    p50, p95 = percentile(samples, 50), percentile(samples, 95)
    assert p50 is not None
    assert p95 is not None
    return {
        "samples": len(samples),
        "p50_ms": round(p50),
        "p95_ms": round(p95),
        "max_ms": round(max(samples)),
    }
