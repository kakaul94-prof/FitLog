"""Row-level security tested in Postgres itself, without the API in between.

Each test switches to the `authenticated` role with a user's JWT claims (exactly
what PostgREST does per request), so a policy is exercised directly.
"""

import pytest
from psycopg import Connection, errors, sql
from psycopg.rows import DictRow

from testkit.db import acting_as
from testkit.factories import db_build_row, db_create_row, db_insert
from testkit.tables import Row as TableRow
from testkit.tables import TableSpec

DB = Connection[DictRow]


@pytest.fixture
def owned_row(table: TableSpec, db: DB, db_owner: str) -> TableRow:
    with acting_as(db, db_owner) as cur:
        return db_create_row(cur, table)


def _where_id(table: TableSpec) -> sql.Composed:
    return sql.SQL("{} where id = %s").format(sql.Identifier(table.name))


def test_policy_shows_owners_their_own_rows(
    table: TableSpec, db: DB, owned_row: TableRow, db_owner: str
) -> None:
    """The control for the tests below: they only mean something if this passes."""
    with acting_as(db, db_owner) as cur:
        cur.execute(sql.SQL("select count(*) as n from ") + _where_id(table), (owned_row["id"],))
        found = cur.fetchone()

    assert found == {"n": 1}


def test_policy_hides_other_users_rows(
    table: TableSpec, db: DB, owned_row: TableRow, db_intruder: str
) -> None:
    with acting_as(db, db_intruder) as cur:
        cur.execute(sql.SQL("select count(*) as n from ") + _where_id(table), (owned_row["id"],))
        found = cur.fetchone()

    assert found == {"n": 0}


def test_policy_blocks_updates_to_other_users_rows(
    table: TableSpec, db: DB, owned_row: TableRow, db_intruder: str
) -> None:
    column, new_value = table.edit
    with acting_as(db, db_intruder) as cur:
        cur.execute(
            sql.SQL("update {} set {} = %s where id = %s").format(
                sql.Identifier(table.name), sql.Identifier(column)
            ),
            (new_value, owned_row["id"]),
        )
        assert cur.rowcount == 0


def test_policy_blocks_deleting_other_users_rows(
    table: TableSpec, db: DB, owned_row: TableRow, db_intruder: str
) -> None:
    with acting_as(db, db_intruder) as cur:
        cur.execute(sql.SQL("delete from ") + _where_id(table), (owned_row["id"],))
        assert cur.rowcount == 0


def test_policy_blocks_inserting_rows_for_another_user(
    table: TableSpec, db: DB, db_owner: str, db_intruder: str
) -> None:
    with acting_as(db, db_intruder) as cur:
        row = db_build_row(cur, table) | {table.owner_column: db_owner}

    with pytest.raises(errors.InsufficientPrivilege), acting_as(db, db_intruder) as cur:
        db_insert(cur, table.name, row)
