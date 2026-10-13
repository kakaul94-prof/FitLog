"""Restoring a backup: all of it or none of it.

A restore replaces every table in the backup file. Done as many separate
requests, a failure part-way (lost signal, a row the database refuses) leaves
the account half-wiped. restore_backup (supabase/schema.sql) does it in one
call, so Postgres runs it as one transaction. These tests hold it to that:

- a good backup replaces the account's data exactly, and running it twice
  gives the same result;
- a backup with a bad row anywhere, however late, changes nothing;
- every restored row belongs to the caller, other accounts are untouched,
  keys that aren't backup tables are ignored, tables missing from the file
  are left alone, and a signed-out caller can't restore at all;
- a large backup finishes inside the 8 s statement timeout.
"""

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import httpx
import pytest
from psycopg import Connection
from psycopg.rows import DictRow

from testkit.auth import SignedInUser
from testkit.factories import create_row
from testkit.models import parse_error
from testkit.rest import RestClient, Row
from testkit.tables import DAY, TABLES_BY_NAME

# The app's export order (src/features/settings/exportData.ts): parents first.
BACKUP_TABLES = (
    "profiles",
    "foods",
    "recipe_ingredients",
    "diary_entries",
    "meals",
    "meal_items",
    "custom_activities",
    "exercise_entries",
    "custom_exercises",
    "exercise_notes",
    "strength_goals",
    "routines",
    "routine_exercises",
    "workouts",
    "workout_exercises",
    "workout_sets",
    "measurements",
)
FOREIGN_KEY = "23503"

Backup = dict[str, list[Row]]


def seed_account(api: RestClient) -> None:
    """A small account with linked rows: recipe → ingredients, workout → sets, meal → items."""
    for table in (
        "recipe_ingredients",
        "diary_entries",
        "meal_items",
        "exercise_entries",
        "routine_exercises",
        "workout_sets",
        "measurements",
    ):
        create_row(api, TABLES_BY_NAME[table])


def export(api: RestClient) -> Backup:
    """What the app's "Export my data" saves: every table's rows."""
    return {table: api.rows(table) for table in BACKUP_TABLES}


def snapshot(api: RestClient) -> dict[str, list[Row]]:
    """The account's data, comparable across a restore (updated_at is touched by triggers)."""
    return {
        table: sorted(
            ({k: v for k, v in row.items() if k != "updated_at"} for row in api.rows(table)),
            key=lambda row: str(row["id"]),
        )
        for table in BACKUP_TABLES
    }


def restore(api: RestClient, backup: dict[str, Any]) -> httpx.Response:
    return api.rpc("restore_backup", {"backup": backup})


def change_things(api: RestClient) -> None:
    """Edits made after the export, which a restore must undo."""
    (entry,) = api.rows("diary_entries")
    api.delete("diary_entries", {"id": entry["id"]})
    create_row(api, TABLES_BY_NAME["foods"])
    (weigh_in,) = api.rows("measurements")
    api.update("measurements", {"value": 999}, {"id": weigh_in["id"]})


def test_a_restore_replaces_the_account_with_the_backup(fresh_api: RestClient) -> None:
    seed_account(fresh_api)
    backup = export(fresh_api)
    exported = snapshot(fresh_api)
    change_things(fresh_api)

    resp = restore(fresh_api, backup)

    assert resp.status_code in (200, 204), resp.text
    assert snapshot(fresh_api) == exported


def test_restoring_the_same_backup_twice_gives_the_same_result(fresh_api: RestClient) -> None:
    seed_account(fresh_api)
    backup = export(fresh_api)
    exported = snapshot(fresh_api)
    change_things(fresh_api)

    for _ in range(2):
        assert restore(fresh_api, backup).status_code in (200, 204)

    assert snapshot(fresh_api) == exported


def orphan_set(backup: Backup) -> None:
    """A set pointing at a workout that isn't in the backup (or anywhere)."""
    backup["workout_sets"].append(
        {"id": str(uuid4()), "workout_id": str(uuid4()), "exercise_key": "back_squat"}
        | {"exercise_name": "Back Squat", "reps": 5, "weight_lb": 225}
    )


def not_an_object(backup: Backup) -> None:
    backup["measurements"].append("this should be a row")  # type: ignore[arg-type]


def wrong_type(backup: Backup) -> None:
    backup["measurements"].append({"id": str(uuid4()), "measured_on": DAY, "value": "heavy"})


@pytest.mark.parametrize(
    "corrupt", [orphan_set, not_an_object, wrong_type], ids=lambda f: f.__name__
)
def test_a_backup_refused_partway_changes_nothing(
    fresh_api: RestClient, corrupt: Callable[[Backup], None]
) -> None:
    seed_account(fresh_api)
    backup = export(fresh_api)
    change_things(fresh_api)
    current = snapshot(fresh_api)
    corrupt(backup)  # the bad row is in one of the last tables restored

    resp = restore(fresh_api, backup)

    assert resp.status_code >= 400
    assert snapshot(fresh_api) == current, "nothing was wiped or half-restored"


def test_a_refused_row_reports_why(fresh_api: RestClient) -> None:
    seed_account(fresh_api)
    backup = export(fresh_api)
    orphan_set(backup)

    resp = restore(fresh_api, backup)

    assert resp.status_code == 409
    assert parse_error(resp).code == FOREIGN_KEY


def test_rows_stamped_with_another_user_are_restored_as_the_callers(
    fresh_api: RestClient, intruder_api: RestClient
) -> None:
    seed_account(fresh_api)
    backup = export(fresh_api)
    others_data = snapshot(intruder_api)
    (intruder_profile,) = intruder_api.rows("profiles")
    stamped = {
        table: [row | {"user_id": intruder_profile["id"]} for row in rows]
        for table, rows in backup.items()
        if table != "profiles"
    }

    assert restore(fresh_api, stamped).status_code in (200, 204)

    for table, rows in stamped.items():  # you only ever see your own rows, so these are yours
        assert len(fresh_api.rows(table)) == len(rows), table
    assert snapshot(intruder_api) == others_data, "nothing landed in the other account"


def test_tables_missing_from_the_backup_are_left_alone(fresh_api: RestClient) -> None:
    seed_account(fresh_api)
    foods_before = fresh_api.rows("foods")
    weigh_ins = fresh_api.rows("measurements")
    create_row(fresh_api, TABLES_BY_NAME["measurements"])

    assert restore(fresh_api, {"measurements": weigh_ins}).status_code in (200, 204)

    assert fresh_api.rows("measurements") == weigh_ins
    assert fresh_api.rows("foods") == foods_before


def test_keys_that_are_not_backup_tables_are_ignored(fresh_api: RestClient) -> None:
    seed_account(fresh_api)
    before = snapshot(fresh_api)
    sneaky: dict[str, Any] = {
        "users": [{"id": str(uuid4())}],
        "foods; drop table public.foods": [],
        'foods" cascade; --': [],
    }

    resp = restore(fresh_api, sneaky)

    assert resp.status_code in (200, 204), resp.text
    assert snapshot(fresh_api) == before


def test_a_signed_out_caller_cannot_restore(anon_api: RestClient) -> None:
    resp = restore(anon_api, {"measurements": []})

    assert resp.status_code in (401, 403)


def test_a_large_backup_restores_within_the_time_limit(
    fresh_api: RestClient, fresh_user: SignedInUser, db_conn: Connection[DictRow]
) -> None:
    rows = [
        {"id": str(uuid4()), "entry_date": DAY, "food_name": f"Entry {i}", "nutrients": {"kcal": i}}
        for i in range(5000)
    ]

    resp = restore(fresh_api, {"diary_entries": rows})  # one call, under the 8 s statement timeout

    assert resp.status_code in (200, 204), resp.text
    # Counted in the database: the API returns at most 1000 rows per request.
    counted = db_conn.execute(
        "select count(*) as n from public.diary_entries where user_id = %s", (fresh_user.id,)
    ).fetchone()
    assert counted is not None
    assert counted["n"] == 5000
