"""Oversized input: refused cleanly, never a server error, never stored.

A food name or a note is typed by a person, so a 100 KB one is either a bug or
an attempt to bloat the database. Each free-text column should refuse it with a
4xx (a CHECK violation), while realistic long values still save.
"""

import pytest

from testkit.factories import build_row
from testkit.models import parse_error
from testkit.rest import RestClient
from testkit.tables import TABLES_BY_NAME

CHECK = "23514"
OVERSIZED = "x" * 100_000

# table, column, a long but realistic value that must still be accepted
FREE_TEXT = [
    ("foods", "name", "Grandma's slow-cooked beef and barley stew with root vegetables " * 2),
    ("diary_entries", "food_name", "Large oat-milk latte with an extra shot and vanilla " * 2),
    ("meals", "name", "Usual weekday breakfast before the gym"),
    ("routines", "name", "Upper body A: heavy bench, rows and accessories"),
    ("custom_exercises", "name", "Single-arm landmine press, half-kneeling"),
    ("custom_activities", "name", "Indoor rowing, steady state"),
    ("workouts", "notes", "Felt strong. Left knee a bit stiff on the warm-up sets. " * 20),
    ("exercise_notes", "notes", "Brace before unracking, elbows under the bar. " * 40),
    ("workout_sets", "pain", "left shoulder"),
]


def _ids(case: tuple[str, str, str]) -> str:
    return f"{case[0]}.{case[1]}"


@pytest.mark.parametrize("case", FREE_TEXT, ids=_ids)
def test_a_realistic_long_value_is_accepted(
    case: tuple[str, str, str], owner_api: RestClient
) -> None:
    table, column, value = case
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: value}

    resp = owner_api.insert(table, row)

    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("case", FREE_TEXT, ids=_ids)
def test_an_oversized_value_is_refused_cleanly(
    case: tuple[str, str, str], owner_api: RestClient
) -> None:
    table, column, _ = case
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: OVERSIZED}

    resp = owner_api.insert(table, row)

    assert resp.status_code == 400, f"{resp.status_code}: {resp.text[:300]}"
    assert parse_error(resp).code == CHECK
