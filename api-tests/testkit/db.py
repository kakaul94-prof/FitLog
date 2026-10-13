"""Direct Postgres access for testing the RLS policies themselves.

`acting_as` reproduces what PostgREST does for each request (switch to the
`authenticated` or `anon` role and publish the JWT claims that `auth.uid()`
reads), so these tests exercise the policies without the API in between.
Everything runs inside a transaction that the `db` fixture always rolls back,
so database tests leave nothing behind.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from uuid import uuid4

import psycopg
from psycopg import Connection, Cursor, sql
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow, dict_row


def connect(db_url: str) -> Connection[DictRow]:
    # autocommit: transactions are only ever the explicit `conn.transaction()` blocks.
    return psycopg.connect(db_url, row_factory=dict_row, autocommit=True)


@contextmanager
def acting_as(conn: Connection[DictRow], user_id: str | None) -> Iterator[Cursor[DictRow]]:
    """Run as a signed-in user (or as an anonymous visitor when `user_id` is None).

    The block runs in a savepoint, so an expected error inside it rolls back just
    the block. Wrap `pytest.raises` *around* this context manager, not inside it,
    so the savepoint sees the error.
    """
    role = "authenticated" if user_id else "anon"
    claims = {"sub": user_id, "role": role} if user_id else {"role": role}
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
        try:
            yield cur
        finally:
            # After an error the savepoint rollback undoes both settings for us.
            if conn.info.transaction_status != TransactionStatus.INERROR:
                cur.execute("reset role")
                cur.execute("select set_config('request.jwt.claims', '', true)")


def create_auth_user(conn: Connection[DictRow]) -> str:
    """Insert a bare auth user (as the superuser), the way a signup would.

    The on_auth_user_created trigger gives it a profile, just like a real signup.
    """
    user_id = str(uuid4())
    conn.execute(
        """
        insert into auth.users
          (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
           created_at, updated_at)
        values
          ('00000000-0000-0000-0000-000000000000', %s, 'authenticated', 'authenticated',
           %s, '{}', '{}', now(), now())
        """,
        (user_id, f"db-{user_id}@api.test"),
    )
    return user_id
