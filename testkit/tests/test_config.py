"""`Settings.from_env`: the guard that keeps every suite on the local stack."""

import pytest

from testkit.config import ConfigError, Settings

SECRETS = {
    "SUPABASE_ANON_KEY": "anon-key-0123456789",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-key-0123456789",
    "SUPABASE_JWT_SECRET": "jwt-secret-0123456789",
    "SUPABASE_DB_URL": "postgresql://postgres:db-password-0123@127.0.0.1:54322/postgres",
}
LOCAL = {"SUPABASE_URL": "http://127.0.0.1:54321/", **SECRETS}


@pytest.fixture
def local_stack(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name, value in LOCAL.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("FITLOG_FUNCTIONS_URL", raising=False)
    monkeypatch.delenv("FITLOG_STUB_URL", raising=False)
    return monkeypatch


def test_reads_the_local_stack_and_trims_trailing_slashes(local_stack: pytest.MonkeyPatch) -> None:
    local_stack.setenv("FITLOG_FUNCTIONS_URL", "http://127.0.0.1:8788/")
    settings = Settings.from_env()
    assert settings.supabase_url == "http://127.0.0.1:54321"
    assert settings.functions_url == "http://127.0.0.1:8788"
    assert settings.stub_url is None  # optional servers are simply absent


def test_names_every_missing_variable(local_stack: pytest.MonkeyPatch) -> None:
    local_stack.delenv("SUPABASE_ANON_KEY")
    local_stack.setenv("SUPABASE_JWT_SECRET", "")
    with pytest.raises(ConfigError, match="SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET"):
        Settings.from_env()


@pytest.mark.parametrize(
    ("name", "url"),
    [
        ("SUPABASE_URL", "https://abcdefgh.supabase.co"),
        ("SUPABASE_DB_URL", "postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"),
        ("FITLOG_FUNCTIONS_URL", "https://fitlog-9wl.pages.dev"),
        ("FITLOG_STUB_URL", "http://10.0.0.5:8790"),
    ],
)
def test_refuses_anything_but_a_local_stack(
    local_stack: pytest.MonkeyPatch, name: str, url: str
) -> None:
    local_stack.setenv(name, url)
    with pytest.raises(ConfigError, match=name):
        Settings.from_env()


def test_keys_and_the_database_password_stay_out_of_repr(local_stack: pytest.MonkeyPatch) -> None:
    # A failing test prints its fixtures: none of these may end up in a report.
    shown = repr(Settings.from_env())
    assert [name for name, value in SECRETS.items() if value in shown] == []
    assert "127.0.0.1:54321" in shown
