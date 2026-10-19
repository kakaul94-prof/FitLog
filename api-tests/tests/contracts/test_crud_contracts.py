"""CRUD contracts: status codes and response shapes for every per-user table.

Create, read, update and delete run over every table in the registry, and each
response is validated against its strict pydantic contract (testkit/models.py):
an unexpected column, a missing one or a wrong type fails the test.
"""

import json
from datetime import datetime

from testkit.auth import SignedInUser
from testkit.factories import build_row, create_row
from testkit.models import parse_rows
from testkit.rest import RestClient, Row
from testkit.tables import TableSpec

# -- generic CRUD over every table ---------------------------------------------


def test_create_returns_the_stored_row(
    insertable: TableSpec, owner_api: RestClient, owner: SignedInUser
) -> None:
    sent = build_row(owner_api, insertable)

    resp = owner_api.insert(insertable.name, sent)

    assert resp.status_code == 201
    (created,) = parse_rows(insertable.model, resp)
    body = created.model_dump(mode="json")
    assert body["user_id"] == owner.id, "user_id defaults to the caller"
    assert {k: body[k] for k in sent} == sent, "every sent value is stored as sent"


def test_read_by_id_matches_the_contract(table: TableSpec, owner_api: RestClient) -> None:
    row = create_row(owner_api, table)

    resp = owner_api.select(table.name, {"id": row["id"]})

    assert resp.status_code == 200
    (read,) = parse_rows(table.model, resp)
    assert read.model_dump(mode="json") == _normalized(table, row)


def test_update_changes_only_the_edited_column(table: TableSpec, owner_api: RestClient) -> None:
    before = _normalized(table, create_row(owner_api, table))
    column, new_value = table.edit

    resp = owner_api.update(table.name, {column: new_value}, {"id": before["id"]})

    assert resp.status_code == 200
    (updated,) = parse_rows(table.model, resp)
    after = updated.model_dump(mode="json")
    assert after[column] == new_value
    unchanged = set(before) - {column, "updated_at"}
    assert {k: after[k] for k in unchanged} == {k: before[k] for k in unchanged}
    if "updated_at" in before:
        assert _ts(after["updated_at"]) > _ts(before["updated_at"]), "trigger bumps updated_at"


def test_delete_returns_the_row_and_removes_it(
    insertable: TableSpec, owner_api: RestClient
) -> None:
    row = create_row(owner_api, insertable)

    resp = owner_api.delete(insertable.name, {"id": row["id"]})

    assert resp.status_code == 200
    assert [r.model_dump(mode="json")["id"] for r in parse_rows(insertable.model, resp)] == [
        row["id"]
    ]
    assert owner_api.row(insertable.name, row["id"]) is None


# -- helpers ---------------------------------------------------------------------------


def _json(row: Row) -> str:
    return json.dumps(row)


def _normalized(table: TableSpec, row: Row) -> Row:
    """A raw API row, validated and re-serialized the same way as a parsed response."""
    return table.model.model_validate_json(_json(row)).model_dump(mode="json")


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value)
