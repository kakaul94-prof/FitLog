"""The leak scanner itself: a check that never fires proves nothing.

These run without the stack. Each sample is something the sensitive-data tests
rely on `find_leaks` to catch, plus clean error bodies it must let through.
"""

import pytest

from testkit.leaks import find_leaks

LEAKY = {
    "a JWT": '{"token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl"}',
    "an Anthropic API key": "upstream said: invalid key sk-ant-api03-AbCdEfGh12345678",
    "a Python traceback": 'Traceback (most recent call last):\n  File "app.py", line 1',
    "a JavaScript stack frame": "TypeError: oops\n    at onRequestPost (trainer.ts:42:13)",
    "a source file path": "ENOENT: no such file, open '/home/runner/work/app/node_modules/x'",
    "a database connection string": "could not connect to postgresql://postgres:pw@db:5432/postgres",
    "an internal service address": "upstream connect error: supabase_db_fitlog:5432 refused",
}

CLEAN = [
    '{"code":"42501","details":null,"hint":null,'
    '"message":"new row violates row-level security policy for table \\"foods\\""}',
    '{"error":"Too many requests just now. Wait a few seconds and ask again."}',
    '{"statusCode":"404","error":"not_found","message":"Object not found"}',
]


@pytest.mark.parametrize("label", LEAKY)
def test_each_kind_of_leak_is_caught(label: str) -> None:
    found = find_leaks(LEAKY[label])

    assert [f for f in found if f.startswith(label)], f"missed {label}: {found}"


@pytest.mark.parametrize("body", CLEAN)
def test_ordinary_error_bodies_pass(body: str) -> None:
    assert find_leaks(body) == []


def test_named_secrets_and_other_users_data_are_caught_verbatim() -> None:
    body = '{"error": "bad key hunter2", "who": "alice@example.com"}'

    found = find_leaks(body, secrets={"API key": "hunter2"}, others_data=["alice@example.com"])

    assert found == ["the API key", "another user's data ('alice@example.com')"]
