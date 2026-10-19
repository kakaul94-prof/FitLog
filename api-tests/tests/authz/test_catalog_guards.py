"""Catalog guards: the database's own description of itself, checked as data.

These don't send requests; they read Postgres's catalogs so that a schema change
can't quietly open a hole. A new table without RLS, a policy that isn't
owner-only, a public bucket or an API-callable SECURITY DEFINER function fails
here before any data test could notice. They also keep the suite honest: a new
table must be added to testkit/tables.py, or the isolation tests would skip it.
"""

from psycopg import Connection
from psycopg.rows import DictRow

from testkit.tables import TABLES_BY_NAME

DB = Connection[DictRow]


def _public_tables(db: DB) -> set[str]:
    rows = db.execute("select tablename from pg_tables where schemaname = 'public'").fetchall()
    return {r["tablename"] for r in rows}


def test_every_public_table_is_covered_by_the_isolation_suite(db: DB) -> None:
    """A new table must be added to testkit/tables.py (one line) to pass."""
    assert _public_tables(db) == set(TABLES_BY_NAME)


def test_every_public_table_has_row_level_security_enabled(db: DB) -> None:
    rows = db.execute(
        """
        select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
          and not relrowsecurity
        """
    ).fetchall()

    assert [r["relname"] for r in rows] == []


def test_every_public_table_has_an_owner_only_policy(db: DB) -> None:
    policies = db.execute(
        "select tablename, cmd, qual, with_check from pg_policies where schemaname = 'public'"
    ).fetchall()
    by_table = {p["tablename"]: p for p in policies}

    assert set(by_table) == _public_tables(db), "every table needs a policy"
    for name, policy in by_table.items():
        owner = TABLES_BY_NAME[name].owner_column
        expected = f"(auth.uid() = {owner})"
        assert policy["cmd"] == "ALL", name
        assert policy["qual"] == expected, name
        assert policy["with_check"] == expected, name


def test_form_video_bucket_is_private_and_size_capped(db: DB) -> None:
    """Private: no public URLs. Capped: the bucket's own limit is what applies to uploads."""
    bucket = db.execute(
        "select public, file_size_limit from storage.buckets where id = 'form-videos'"
    ).fetchone()

    assert bucket == {"public": False, "file_size_limit": 200 * 1024 * 1024}


def test_every_owner_column_defaults_to_the_caller(db: DB) -> None:
    """Rows are owned by whoever creates them unless the client says otherwise."""
    rows = db.execute(
        """
        select table_name, column_default from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id'
        """
    ).fetchall()

    assert rows, "expected user_id columns"
    assert {r["table_name"]: r["column_default"] for r in rows} == {
        r["table_name"]: "auth.uid()" for r in rows
    }


def test_no_security_definer_function_is_callable_through_the_api(db: DB) -> None:
    """SECURITY DEFINER runs with the owner's rights and skips RLS.

    The only one allowed is a trigger function (the signup trigger), which
    PostgREST can't call as an RPC. Anything else would be a privileged endpoint.
    """
    rows = db.execute(
        """
        select p.proname, p.prorettype::regtype::text as returns
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prosecdef
        """
    ).fetchall()

    assert [r for r in rows if r["returns"] != "trigger"] == []


def test_api_roles_have_no_access_to_the_auth_schema(db: DB) -> None:
    rows = db.execute(
        """
        select grantee, table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'auth' and grantee in ('anon', 'authenticated')
        """
    ).fetchall()

    assert rows == []
