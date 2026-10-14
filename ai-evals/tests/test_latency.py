"""Latency maths: the percentiles and the per-category budget report, on known numbers.

The canary alerts on these figures and the dashboard charts them, so an
off-by-one in a percentile would page someone, or hide a slow endpoint.
"""

import pytest

from aievals.dataset import CATEGORIES
from aievals.latency import Sample, percentile, report, summarize_ms
from aievals.thresholds import LATENCY_BUDGETS_MS


@pytest.mark.parametrize(
    ("values", "p", "expected"),
    [
        ([], 50, None),
        ([7.0], 95, 7.0),
        ([1.0, 2.0, 3.0, 4.0], 50, 2.0),  # nearest rank: ceil(0.5 * 4) = 2nd
        ([1.0, 2.0, 3.0, 4.0], 95, 4.0),
        ([float(i) for i in range(1, 21)], 95, 19.0),  # ceil(0.95 * 20) = 19th
        ([float(i) for i in range(1, 101)], 95, 95.0),
        ([3.0, 1.0, 2.0], 0, 1.0),  # unsorted input, the lowest rank is 1
    ],
)
def test_percentiles_are_nearest_rank(
    values: list[float], p: float, expected: float | None
) -> None:
    assert percentile(values, p) == expected


def test_a_summary_is_rounded_milliseconds_or_nothing() -> None:
    assert summarize_ms([]) is None
    assert summarize_ms([1200.4, 900.6, 4100.5]) == {
        "samples": 3,
        "p50_ms": 1200,
        "p95_ms": 4100,
        "max_ms": 4100,
    }


def test_each_category_is_held_to_its_own_budget() -> None:
    samples = [
        Sample("prompt_injection", 1_000, 400),
        Sample("prompt_injection", 11_000, 500),  # over a 10 s budget
        Sample("output_quality", 11_000, 600),  # under a 15 s budget
        Sample("unbudgeted", 99_000, 700),
    ]

    r = report(samples, {"prompt_injection": 10_000, "output_quality": 15_000})

    assert r is not None
    assert (r["samples"], r["p50_ms"], r["p95_ms"], r["max_ms"]) == (4, 11_000, 99_000, 99_000)
    assert (r["first_byte_p50_ms"], r["first_byte_p95_ms"]) == (500, 700)
    assert r["categories"]["prompt_injection"] == {
        "samples": 2,
        "p50_ms": 1_000,
        "p95_ms": 11_000,
        "max_ms": 11_000,
        "budget_p95_ms": 10_000,
        "ok": False,
    }
    assert r["categories"]["output_quality"]["ok"] is True
    assert r["categories"]["unbudgeted"]["ok"] is True, "no budget: reported, never over"
    assert (r["over_budget"], r["ok"]) == (["prompt_injection"], False)


def test_no_answers_means_no_latency_report() -> None:
    assert report([], LATENCY_BUDGETS_MS) is None


def test_every_category_has_a_budget_under_the_functions_stall_timeout() -> None:
    assert set(LATENCY_BUDGETS_MS) == set(CATEGORIES)
    assert all(0 < b < 20_000 for b in LATENCY_BUDGETS_MS.values())
