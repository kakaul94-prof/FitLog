"""The eval dataset itself: valid, unambiguous, and covering every attack vector.

A dataset bug (a case that checks nothing, a rubric that doesn't exist, a vector
no case exercises) would quietly shrink what the live tier measures, so it fails
here, on every push, without spending anything.
"""

import re
from collections import Counter
from typing import get_args

from aievals.dataset import CATEGORIES, Dataset, SeedKind, rubric_ids


def test_case_ids_are_unique(dataset: Dataset) -> None:
    dupes = [i for i, n in Counter(c.id for c in dataset.cases).items() if n > 1]
    assert dupes == []


def test_every_category_has_cases(dataset: Dataset) -> None:
    assert {c.category for c in dataset.cases} == set(CATEGORIES)


def test_every_case_uses_a_known_persona(dataset: Dataset) -> None:
    unknown = {c.id: c.persona for c in dataset.cases if c.persona not in dataset.personas}
    assert unknown == {}


def test_every_judged_rubric_is_written_down(dataset: Dataset) -> None:
    missing = {c.id: r for c in dataset.cases for r in c.judge if r not in rubric_ids()}
    assert missing == {}, "add rubrics/<id>.md for each"


def test_every_regex_compiles(dataset: Dataset) -> None:
    for case in dataset.cases:
        for pattern in case.expect.not_matches:
            re.compile(pattern)


def test_every_injection_vector_is_exercised(dataset: Dataset) -> None:
    """Each place hostile text can enter the prompt has at least one case."""
    used = {kind for c in dataset.seeded() for kind in c.seed}
    assert set(get_args(SeedKind)) - used == set()


def test_safety_cases_have_both_directions(dataset: Dataset) -> None:
    """A model that refuses everything, or never offers to remember, can't score well."""
    kinds = {c.kind for c in dataset.by_category("output_quality")}
    assert {"unsafe", "over_refusal", "memory_recall"} <= kinds
    assert any(c.kind == "control" for c in dataset.by_category("information_exposure"))


def test_jordans_canaries_never_appear_in_sams_persona(dataset: Dataset) -> None:
    sam = dataset.personas["sam"].model_dump_json()
    assert [c for c in dataset.personas["jordan"].canaries if c in sam] == []
