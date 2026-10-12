"""Create rows for a `TableSpec`, building any parent rows first as the same user.

There are two writers with the same shape: one through the REST API (what the app
does) and one straight into Postgres (for the database-level policy tests).
"""

from uuid import uuid4

from psycopg import Cursor, sql
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from testkit.rest import RestClient, Row
from testkit.tables import TABLES_BY_NAME, RowContext, TableSpec


def new_token() -> str:
    return uuid4().hex[:12]


# -- through the API ---------------------------------------------------------


def build_row(api: RestClient, spec: TableSpec) -> Row:
    """A valid row for `spec`, not yet inserted. Its parents are created as `api`'s user."""
    parents = {
        alias: create_row(api, TABLES_BY_NAME[table])["id"] for alias, table in spec.parents.items()
    }
    return spec.sample(RowContext(token=new_token(), parents=parents))


def create_row(api: RestClient, spec: TableSpec) -> Row:
    """Insert one row for `spec` as `api`'s user (or fetch the profile, which already exists)."""
    if spec.one_per_user:
        (profile,) = api.rows(spec.name)
        return profile
    return api.create(spec.name, build_row(api, spec))


# -- straight into Postgres ----------------------------------------------------


def db_build_row(cur: Cursor[DictRow], spec: TableSpec) -> Row:
    parents = {
        alias: db_create_row(cur, TABLES_BY_NAME[table])["id"]
        for alias, table in spec.parents.items()
    }
    return spec.sample(RowContext(token=new_token(), parents=parents))


def db_create_row(cur: Cursor[DictRow], spec: TableSpec) -> Row:
    """Insert as whoever the cursor is acting as (see `db.acting_as`)."""
    if spec.one_per_user:
        cur.execute(
            sql.SQL("select * from {} where {} = auth.uid()").format(
                sql.Identifier(spec.name), sql.Identifier(spec.owner_column)
            )
        )
        profile = cur.fetchone()
        assert profile is not None, "the signup trigger should have created a profile"
        return profile
    return db_insert(cur, spec.name, db_build_row(cur, spec))


def db_insert(cur: Cursor[DictRow], table: str, row: Row) -> Row:
    columns = list(row)
    cur.execute(
        sql.SQL("insert into {} ({}) values ({}) returning *").format(
            sql.Identifier(table),
            sql.SQL(", ").join(map(sql.Identifier, columns)),
            sql.SQL(", ").join(sql.Placeholder() * len(columns)),
        ),
        [_adapt(row[c]) for c in columns],
    )
    inserted = cur.fetchone()
    assert inserted is not None
    return inserted


def _adapt(value: object) -> object:
    return Jsonb(value) if isinstance(value, dict | list) else value
