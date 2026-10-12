"""Links between users' data: a row may only point at rows its own user owns.

Row-level security checks the owner of the row being written, but Postgres
checks a foreign key without applying RLS. So unless the schema ties both
owners together, a user can attach their rows to someone else's workout, meal,
routine or food, and the owner's later deletes cascade into, or are blocked by,
rows they can't even see. Every foreign key between per-user tables is listed
in REFERENCES, and a catalog test fails if a new one is added without it.
"""

from dataclasses import dataclass
from uuid import uuid4

import pytest
from psycopg import Connection
from psycopg.rows import DictRow

from testkit.factories import build_row, create_row
from testkit.models import parse_error
from testkit.rest import RestClient
from testkit.tables import TABLES_BY_NAME

FOREIGN_KEY = "23503"


@dataclass(frozen=True)
class Reference:
    """A foreign key from one per-user table to another."""

    child: str
    column: str
    parent: str

    def __str__(self) -> str:
        return f"{self.child}.{self.column}"


REFERENCES = (
    Reference("recipe_ingredients", "recipe_food_id", "foods"),
    Reference("recipe_ingredients", "ingredient_food_id", "foods"),
    Reference("diary_entries", "food_id", "foods"),
    Reference("meal_items", "meal_id", "meals"),
    Reference("meal_items", "food_id", "foods"),
    Reference("routine_exercises", "routine_id", "routines"),
    Reference("workouts", "source_routine_id", "routines"),
    Reference("workout_exercises", "workout_id", "workouts"),
    Reference("workout_sets", "workout_id", "workouts"),
    Reference("workout_sets", "workout_exercise_id", "workout_exercises"),
)


@pytest.mark.parametrize("ref", REFERENCES, ids=str)
def test_reference_to_a_missing_row_is_refused(ref: Reference, owner_api: RestClient) -> None:
    row = build_row(owner_api, TABLES_BY_NAME[ref.child]) | {ref.column: str(uuid4())}

    resp = owner_api.insert(ref.child, row)

    assert resp.status_code == 409
    assert parse_error(resp).code == FOREIGN_KEY


@pytest.mark.parametrize("ref", REFERENCES, ids=str)
def test_rows_cannot_reference_another_users_data(
    ref: Reference, owner_api: RestClient, intruder_api: RestClient
) -> None:
    """RLS checks the new row's owner, but a foreign key check doesn't apply RLS.

    So unless the schema ties the two owners together, a user can attach rows
    to someone else's workout, meal, routine or food.
    """
    victims_row = create_row(owner_api, TABLES_BY_NAME[ref.parent])
    row = build_row(intruder_api, TABLES_BY_NAME[ref.child]) | {ref.column: victims_row["id"]}

    resp = intruder_api.insert(ref.child, row)

    assert resp.is_client_error, (
        f"{ref} accepted a reference to another user's {ref.parent} row: {resp.text}"
    )


def test_another_user_cannot_stop_you_deleting_your_food(
    owner_api: RestClient, intruder_api: RestClient
) -> None:
    food = create_row(owner_api, TABLES_BY_NAME["foods"])
    their_recipe = create_row(intruder_api, TABLES_BY_NAME["foods"])
    # Tries to use the owner's food as an ingredient (ON DELETE RESTRICT).
    intruder_api.insert(
        "recipe_ingredients",
        {"recipe_food_id": their_recipe["id"], "ingredient_food_id": food["id"]},
    )

    resp = owner_api.delete("foods", {"id": food["id"]})

    assert resp.status_code == 200, resp.text


def test_deleting_your_workout_never_deletes_another_users_rows(
    owner_api: RestClient, intruder_api: RestClient
) -> None:
    workout = create_row(owner_api, TABLES_BY_NAME["workouts"])
    their_set = build_row(intruder_api, TABLES_BY_NAME["workout_sets"]) | {
        "workout_id": workout["id"]
    }
    intruder_api.insert("workout_sets", their_set)  # attempts to hang a set off it
    sets_before = intruder_api.rows("workout_sets")

    owner_api.delete("workouts", {"id": workout["id"]})

    assert intruder_api.rows("workout_sets") == sets_before


def test_every_foreign_key_between_user_tables_is_listed(db: Connection[DictRow]) -> None:
    """A new foreign key must be added to REFERENCES, so its cross-user case gets tested."""
    rows = db.execute(
        """
        select c.conrelid::regclass::text as child, a.attname as column,
               c.confrelid::regclass::text as parent
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f'
          and c.connamespace = 'public'::regnamespace
          and c.confrelid <> 'auth.users'::regclass
        """
    ).fetchall()

    assert {Reference(r["child"], r["column"], r["parent"]) for r in rows} == set(REFERENCES)
