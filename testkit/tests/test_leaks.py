"""`find_leaks`: says exactly what leaked, and nothing when the text is clean."""

import pytest

from testkit.leaks import PATTERNS, find_leaks

SAMPLES = {
    "a JWT": "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl",
    "an Anthropic API key": "key sk-ant-api03-abcdefgh",
    "a Python traceback": "Traceback (most recent call last):",
    "a JavaScript stack frame": "at onRequestPost (/app/functions/api/trainer.ts:120:9)",
    "a source file path": "see /home/runner/work/app",
    "a database connection string": "postgresql://postgres@localhost/postgres",
    "an internal service address": "connect to supabase_db_fitlog failed",
}


def test_every_pattern_has_a_sample() -> None:
    assert sorted(SAMPLES) == sorted(PATTERNS)


@pytest.mark.parametrize(("label", "text"), sorted(SAMPLES.items()))
def test_each_kind_of_leak_is_named(label: str, text: str) -> None:
    assert any(found.startswith(label) for found in find_leaks(text))


def test_clean_text_has_no_leaks() -> None:
    assert find_leaks('{"error": "Sign in to use the trainer."}') == []


def test_secret_values_are_reported_by_label_never_by_value() -> None:
    found = find_leaks("debug: abc123xyz", secrets={"service role key": "abc123xyz", "unset": ""})
    assert found == ["the service role key"]


def test_another_users_data_is_reported() -> None:
    found = find_leaks("owner: bob@api.test", others_data=["bob@api.test", ""])
    assert found == ["another user's data ('bob@api.test')"]
