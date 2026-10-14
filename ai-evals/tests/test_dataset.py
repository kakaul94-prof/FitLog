"""The eval dataset itself: valid, unambiguous, and covering every attack vector.

A dataset bug (a case that checks nothing, a rubric that doesn't exist, a vector
no case exercises) would quietly shrink what the live tier measures, so it fails
here, on every push, without spending anything.
"""

import re
from collections import Counter
from typing import get_args

from aievals.dataset import CATEGORIES, Dataset, SeedKind, rubric_ids
from aievals.equivalence import groups


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


# -- fairness ------------------------------------------------------------------------------


def test_every_fairness_group_varies_one_thing_and_checks_everyone_alike(dataset: Dataset) -> None:
    """A group whose members carried different checks could not show parity or its absence."""
    found = groups(dataset.cases)
    paired = {c.pair.group for c in dataset.cases if c.pair is not None}
    assert {g.id for g in found} == paired, "every group has exactly one baseline"
    for g in found:
        assert g.variants, f"{g.id} has no variant"
        for v in g.variants:
            assert (v.expect, v.judge, v.category) == (
                g.baseline.expect,
                g.baseline.judge,
                "fairness",
            )
            assert v.pair is not None
            assert g.baseline.pair is not None
            assert (v.pair.varies, v.pair.compare, v.pair.allow_differ) == (
                g.baseline.pair.varies,
                g.baseline.pair.compare,
                g.baseline.pair.allow_differ,
            )
            assert not v.seed
            assert not g.baseline.seed
            if v.persona == g.baseline.persona:  # a name pair: only the name differs
                name = re.compile(r"^I'm (\w+)\. ")
                assert name.sub("", v.ask) == name.sub("", g.baseline.ask) != v.ask
            else:  # a persona pair: the question is the same word for word
                assert v.ask == g.baseline.ask


def test_each_twin_differs_from_sam_in_one_field_only(dataset: Dataset) -> None:
    sam = dataset.personas["sam"].model_dump(exclude={"about"})
    expected = {"samira": {"profile.sex"}, "sam-at-64": {"profile.age"}, "sam-at-260": {"weights"}}
    for name, fields in expected.items():
        twin = dataset.personas[name].model_dump(exclude={"about"})
        differ = {k for k in sam if k != "profile" and sam[k] != twin[k]}
        differ |= {
            f"profile.{k}" for k in sam["profile"] if sam["profile"][k] != twin["profile"][k]
        }
        assert differ == fields, name


def test_constraint_cases_cover_diet_culture_faith_and_allergy(dataset: Dataset) -> None:
    asked = " ".join(
        f"{c.ask} {' '.join(c.seed.values())}".lower()
        for c in dataset.by_category("fairness")
        if c.kind == "constraint"
    )
    for constraint in ("vegetarian", "halal", "kosher", "allergy", "ramadan"):
        assert constraint in asked
