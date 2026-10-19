"""Validation and constraints: bad input is refused with the right error.

Covers what supabase/schema.sql actually enforces: required columns, column
types, allowed values (CHECK), numeric ranges (with boundary values on both
sides), per-user uniqueness, and references to rows that don't exist. Links to
another user's rows have their own module (test_cross_user_references.py).
"""

from typing import Any
from uuid import uuid4

import pytest

from testkit.auth import SignedInUser
from testkit.factories import build_row, create_row
from testkit.models import parse_error
from testkit.rest import RestClient
from testkit.tables import TABLES_BY_NAME

NOT_NULL, BAD_TEXT, BAD_DATETIME, CHECK, UNIQUE, FOREIGN_KEY = (
    "23502",
    "22P02",
    "22007",
    "23514",
    "23505",
    "23503",
)

# -- required columns ----------------------------------------------------------

REQUIRED_COLUMNS = [
    ("foods", "name"),
    ("recipe_ingredients", "ingredient_food_id"),
    ("diary_entries", "entry_date"),
    ("diary_entries", "food_name"),
    ("custom_activities", "name"),
    ("exercise_entries", "entry_date"),
    ("exercise_entries", "name"),
    ("custom_exercises", "name"),
    ("routines", "name"),
    ("routine_exercises", "routine_id"),
    ("routine_exercises", "exercise_key"),
    ("workouts", "workout_date"),
    ("workout_exercises", "workout_id"),
    ("workout_sets", "workout_id"),
    ("workout_sets", "exercise_name"),
    ("measurements", "measured_on"),
    ("measurements", "value"),
    ("exercise_notes", "exercise_key"),
    ("meals", "name"),
    ("meal_items", "meal_id"),
    ("meal_items", "food_name"),
    ("form_videos", "storage_path"),
    ("strength_goals", "target_1rm_lb"),
]


@pytest.mark.parametrize(("table", "column"), REQUIRED_COLUMNS, ids=lambda v: str(v))
def test_missing_required_column_is_refused(table: str, column: str, owner_api: RestClient) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[table])
    assert column in row, "the sample row must include the column under test"
    del row[column]

    resp = owner_api.insert(table, row)

    assert resp.status_code == 400
    assert parse_error(resp).code == NOT_NULL


@pytest.mark.parametrize(
    ("table", "column"),
    [
        ("foods", "nutrients"),
        ("diary_entries", "servings"),
        ("exercise_entries", "calories"),
        ("workouts", "completed"),
    ],
    ids=lambda v: str(v),
)
def test_explicit_null_is_refused_even_where_a_default_exists(
    table: str, column: str, owner_api: RestClient
) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: None}

    resp = owner_api.insert(table, row)

    assert resp.status_code == 400
    assert parse_error(resp).code == NOT_NULL


# -- column types ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("table", "column", "value", "code"),
    [
        ("diary_entries", "servings", "two", BAD_TEXT),
        ("diary_entries", "entry_date", "not-a-date", BAD_DATETIME),
        ("workout_sets", "reps", "ten", BAD_TEXT),
        ("workouts", "completed", "maybe", BAD_TEXT),
        ("exercise_entries", "calories", 250.5, BAD_TEXT),  # integer column
        ("routine_exercises", "routine_id", "not-a-uuid", BAD_TEXT),
    ],
    ids=lambda v: str(v),
)
def test_wrong_type_is_refused(
    table: str, column: str, value: str | float, code: str, owner_api: RestClient
) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: value}

    resp = owner_api.insert(table, row)

    assert resp.status_code == 400
    assert parse_error(resp).code == code


def test_unknown_column_is_refused(owner_api: RestClient) -> None:
    row = build_row(owner_api, TABLES_BY_NAME["foods"]) | {"calories_per_bite": 3}

    resp = owner_api.insert("foods", row)

    assert resp.status_code == 400
    assert parse_error(resp).code == "PGRST204"  # column not found


# -- allowed values (CHECK constraints) -------------------------------------------


@pytest.mark.parametrize(
    ("table", "column", "value"),
    [
        ("diary_entries", "meal", "brunch"),
        ("foods", "source", "scraped"),
        ("custom_exercises", "type", "yoga"),
        ("strength_goals", "method", "smolov"),
        ("workout_sets", "feel", "great"),
    ],
    ids=lambda v: str(v),
)
def test_value_outside_the_allowed_list_is_refused(
    table: str, column: str, value: str, owner_api: RestClient
) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: value}

    resp = owner_api.insert(table, row)

    assert resp.status_code == 400
    assert parse_error(resp).code == CHECK


@pytest.mark.parametrize(
    ("column", "value"),
    [("activity_level", "couch"), ("goal_type", "bulk"), ("calorie_goal_mode", "auto")],
    ids=lambda v: str(v),
)
def test_profile_value_outside_the_allowed_list_is_refused(
    column: str, value: str, fresh_api: RestClient, fresh_user: SignedInUser
) -> None:
    resp = fresh_api.update("profiles", {column: value}, {"id": fresh_user.id})

    assert resp.status_code == 400
    assert parse_error(resp).code == CHECK


# -- numeric ranges: boundary values on both sides ----------------------------------

RANGES = [  # table, column, lowest allowed, highest allowed
    ("workout_sets", "effort", 1, 10),
    ("exercise_entries", "zone", 1, 5),
    ("routine_exercises", "target_zone", 1, 5),
]


def _boundaries() -> list[Any]:
    cases = []
    for table, column, low, high in RANGES:
        for value, accepted in ((low - 1, False), (low, True), (high, True), (high + 1, False)):
            verdict = "accepted" if accepted else "refused"
            cases.append(
                pytest.param(table, column, value, accepted, id=f"{column}={value}-{verdict}")
            )
    return cases


@pytest.mark.parametrize(("table", "column", "value", "accepted"), _boundaries())
def test_range_boundaries(
    table: str, column: str, value: int, accepted: bool, owner_api: RestClient
) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[table]) | {column: value}

    resp = owner_api.insert(table, row)

    if accepted:
        assert resp.status_code == 201, resp.text
    else:
        assert resp.status_code == 400
        assert parse_error(resp).code == CHECK


# -- uniqueness ------------------------------------------------------------------------

ONE_PER_EXERCISE = ["exercise_notes", "strength_goals"]


@pytest.mark.parametrize("table", ONE_PER_EXERCISE)
def test_one_row_per_user_and_exercise(table: str, owner_api: RestClient) -> None:
    first = create_row(owner_api, TABLES_BY_NAME[table])
    duplicate = build_row(owner_api, TABLES_BY_NAME[table]) | {
        "exercise_key": first["exercise_key"]
    }

    resp = owner_api.insert(table, duplicate)

    assert resp.status_code == 409
    assert parse_error(resp).code == UNIQUE


@pytest.mark.parametrize("table", ONE_PER_EXERCISE)
def test_different_users_may_use_the_same_exercise(
    table: str, owner_api: RestClient, intruder_api: RestClient
) -> None:
    """Uniqueness is per user, not global."""
    mine = create_row(owner_api, TABLES_BY_NAME[table])
    theirs = build_row(intruder_api, TABLES_BY_NAME[table]) | {"exercise_key": mine["exercise_key"]}

    resp = intruder_api.insert(table, theirs)

    assert resp.status_code == 201


def test_saving_a_note_again_updates_it(owner_api: RestClient, owner: SignedInUser) -> None:
    """The app saves exercise notes with an upsert on (user_id, exercise_key)."""
    key = f"custom:{uuid4().hex}"
    first = owner_api.insert(
        "exercise_notes",
        {"user_id": owner.id, "exercise_key": key, "notes": "Brace"},
        upsert_on="user_id,exercise_key",
    )
    second = owner_api.insert(
        "exercise_notes",
        {"user_id": owner.id, "exercise_key": key, "notes": "Brace, then breathe"},
        upsert_on="user_id,exercise_key",
    )

    assert first.status_code == 201  # inserted
    assert second.status_code == 200  # merged into the existing row
    assert second.json()[0]["id"] == first.json()[0]["id"]
    assert [r["notes"] for r in owner_api.rows("exercise_notes", {"exercise_key": key})] == [
        "Brace, then breathe"
    ]


def test_upsert_cannot_overwrite_another_users_note(
    owner_api: RestClient, intruder_api: RestClient, owner: SignedInUser
) -> None:
    """The app's write path for notes, aimed at someone else's row."""
    note = create_row(owner_api, TABLES_BY_NAME["exercise_notes"])

    resp = intruder_api.insert(
        "exercise_notes",
        {"user_id": owner.id, "exercise_key": note["exercise_key"], "notes": "Overwritten"},
        upsert_on="user_id,exercise_key",
    )

    assert resp.status_code == 403
    assert parse_error(resp).code == "42501"
    assert owner_api.row("exercise_notes", note["id"]) == note
