"""Row-level security through the REST API: users only ever reach their own rows.

Every test runs once per table in `testkit.tables.TABLES` (the `table` fixture). The owner creates a
row, then a second signed-in user (the intruder) and an anonymous visitor try to
read, change, delete or forge it. Owner-side reads afterwards prove nothing changed.
"""

from uuid import uuid4

import pytest

from testkit.auth import SignedInUser
from testkit.factories import build_row, create_row
from testkit.models import parse_error
from testkit.rest import RestClient, Row
from testkit.tables import RowContext, TableSpec


@pytest.fixture
def owned_row(table: TableSpec, owner_api: RestClient) -> Row:
    return create_row(owner_api, table)


def test_another_user_cannot_read_your_rows(
    table: TableSpec, owned_row: Row, intruder_api: RestClient
) -> None:
    resp = intruder_api.select(table.name, {"id": owned_row["id"]})

    assert resp.status_code == 200
    assert resp.json() == []


def test_another_user_cannot_update_your_rows(
    table: TableSpec, owned_row: Row, intruder_api: RestClient, owner_api: RestClient
) -> None:
    column, new_value = table.edit

    resp = intruder_api.update(table.name, {column: new_value}, {"id": owned_row["id"]})

    assert resp.status_code == 200
    assert resp.json() == [], "the update should match no rows"
    assert owner_api.row(table.name, owned_row["id"]) == owned_row


def test_another_user_cannot_delete_your_rows(
    table: TableSpec, owned_row: Row, intruder_api: RestClient, owner_api: RestClient
) -> None:
    resp = intruder_api.delete(table.name, {"id": owned_row["id"]})

    assert resp.status_code == 200
    assert resp.json() == [], "the delete should match no rows"
    assert owner_api.row(table.name, owned_row["id"]) == owned_row


def test_you_cannot_create_rows_owned_by_another_user(
    table: TableSpec, owner: SignedInUser, intruder_api: RestClient
) -> None:
    # Parents (if any) belong to the intruder, so ownership is the only thing wrong.
    row = build_row(intruder_api, table) | {table.owner_column: owner.id}

    resp = intruder_api.insert(table.name, row)

    assert resp.status_code == 403
    assert parse_error(resp).code == "42501"  # row-level security violation


def test_you_cannot_give_your_rows_to_another_user(
    table: TableSpec, owner: SignedInUser, intruder_api: RestClient
) -> None:
    own_row = create_row(intruder_api, table)

    resp = intruder_api.update(table.name, {table.owner_column: owner.id}, {"id": own_row["id"]})

    assert resp.status_code == 403
    assert parse_error(resp).code == "42501"
    assert intruder_api.row(table.name, own_row["id"]) == own_row


def test_signed_out_visitors_see_no_rows(
    table: TableSpec, owned_row: Row, anon_api: RestClient
) -> None:
    resp = anon_api.select(table.name)  # no filter: the whole table

    assert resp.status_code == 200
    assert resp.json() == []


def test_signed_out_visitors_cannot_write(table: TableSpec, anon_api: RestClient) -> None:
    # Parent ids are random: the request must be refused before they matter.
    parents = {alias: str(uuid4()) for alias in table.parents}
    row = table.sample(RowContext(token=uuid4().hex[:12], parents=parents))
    if table.one_per_user:
        row[table.owner_column] = str(uuid4())

    resp = anon_api.insert(table.name, row)

    assert resp.status_code == 401
    assert parse_error(resp).code == "42501"


def test_signed_out_visitors_cannot_change_or_delete_rows(
    table: TableSpec, owned_row: Row, anon_api: RestClient, owner_api: RestClient
) -> None:
    column, new_value = table.edit

    update = anon_api.update(table.name, {column: new_value}, {"id": owned_row["id"]})
    delete = anon_api.delete(table.name, {"id": owned_row["id"]})

    assert (update.status_code, update.json()) == (200, [])
    assert (delete.status_code, delete.json()) == (200, [])
    assert owner_api.row(table.name, owned_row["id"]) == owned_row


def test_an_upsert_cannot_take_over_another_users_row(
    insertable: TableSpec, owner_api: RestClient, intruder_api: RestClient
) -> None:
    """INSERT ... ON CONFLICT (id) DO UPDATE, aimed at a row id the intruder learned.

    The conflict turns the insert into an update of the owner's row, which the
    policy's USING clause must still refuse.
    """
    victims_row = create_row(owner_api, insertable)
    column, new_value = insertable.edit
    takeover = build_row(intruder_api, insertable) | {"id": victims_row["id"], column: new_value}

    resp = intruder_api.insert(insertable.name, takeover, upsert_on="id")

    assert resp.status_code == 403
    assert parse_error(resp).code == "42501"
    assert owner_api.row(insertable.name, victims_row["id"]) == victims_row
