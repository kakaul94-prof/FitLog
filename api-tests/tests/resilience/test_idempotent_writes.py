"""Repeated creates: what the database guarantees when the same write arrives twice.

A phone on a bad connection sends the same insert again: a retry after a
timeout, an offline queue replaying after a restart, a double tap. The app
makes those safe by choosing each row's id itself (a UUID made before the
request is sent), so a repeat is the same row, not a new one. These tests pin
down the server side of that contract for every table the app writes:

- a second insert with the same id is refused (409, unique violation) and the
  table still holds one row, unchanged;
- a replay can't overwrite the first write, and another user can't use the id
  to touch someone else's row;
- a multi-row insert is all-or-nothing, so a replayed batch has either fully
  landed or not at all (the app's replay check relies on this).
"""

from uuid import uuid4

from testkit.factories import build_row, create_row
from testkit.models import parse_error
from testkit.rest import RestClient
from testkit.tables import TABLES_BY_NAME, TableSpec

UNIQUE_VIOLATION = "23505"


def test_a_repeated_insert_with_the_same_id_keeps_one_row(
    insertable: TableSpec, owner_api: RestClient
) -> None:
    row = build_row(owner_api, insertable) | {"id": str(uuid4())}
    first = owner_api.insert(insertable.name, row)
    assert first.status_code == 201

    again = owner_api.insert(insertable.name, row)

    assert again.status_code == 409
    assert parse_error(again).code == UNIQUE_VIOLATION
    assert owner_api.rows(insertable.name, {"id": row["id"]}) == first.json()


def test_a_replay_with_different_values_cannot_overwrite_the_first_write(
    owner_api: RestClient,
) -> None:
    spec = TABLES_BY_NAME["diary_entries"]
    row = build_row(owner_api, spec) | {"id": str(uuid4()), "servings": 1}
    owner_api.create(spec.name, row)

    replay = owner_api.insert(spec.name, row | {"servings": 5})

    assert replay.status_code == 409
    stored = owner_api.row(spec.name, row["id"])
    assert stored is not None
    assert stored["servings"] == 1


def test_another_user_reusing_an_id_cannot_touch_the_owners_row(
    owner_api: RestClient, intruder_api: RestClient
) -> None:
    spec = TABLES_BY_NAME["diary_entries"]
    original = create_row(owner_api, spec)

    taken = intruder_api.insert(spec.name, build_row(intruder_api, spec) | {"id": original["id"]})

    assert taken.status_code == 409
    assert owner_api.row(spec.name, original["id"]) == original
    assert intruder_api.rows(spec.name, {"id": original["id"]}) == []


def test_a_batch_insert_is_all_or_nothing(owner_api: RestClient) -> None:
    spec = TABLES_BY_NAME["diary_entries"]
    already_saved = create_row(owner_api, spec)
    batch = [build_row(owner_api, spec) | {"id": str(uuid4())} for _ in range(2)]
    batch.append(build_row(owner_api, spec) | {"id": already_saved["id"]})

    resp = owner_api.insert(spec.name, batch)

    assert resp.status_code == 409
    for row in batch[:2]:
        assert owner_api.row(spec.name, row["id"]) is None, "no part of a refused batch is kept"
