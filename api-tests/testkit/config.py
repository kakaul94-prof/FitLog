"""Where the suite points, read only from the environment.

Every value comes from the running local Supabase stack (`supabase status -o env`,
wrapped by scripts/local-env.sh). Nothing has a default, so a missing variable
fails loudly instead of silently pointing somewhere else, and every URL must be
local: these tests create users and write rows freely, so they must never run
against the hosted dev or production projects.
"""

import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "host.docker.internal"})

# The Claude API key the local functions server is given (scripts/start-functions.sh
# sets the same value). Not a real key: tests check it is sent upstream and never
# echoed back to the browser.
FAKE_ANTHROPIC_KEY = "sk-ant-test-local-stub-key"

REQUIRED = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_DB_URL",
)


class ConfigError(RuntimeError):
    """The environment doesn't describe a local test stack."""


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    # Keys stay out of repr() so they never land in a failure report.
    anon_key: str = field(repr=False)
    service_role_key: str = field(repr=False)  # fixtures only: creating/deleting users
    jwt_secret: str = field(repr=False)  # only to forge expired / tampered test tokens
    db_url: str = field(repr=False)  # carries the database password
    functions_url: str | None  # Pages Functions server, when it's running
    stub_url: str | None  # the fake Claude API those functions call

    @classmethod
    def from_env(cls) -> "Settings":
        missing = [name for name in REQUIRED if not os.environ.get(name)]
        if missing:
            raise ConfigError(
                f"Missing {', '.join(missing)}. Start the local stack (npm run db:start), "
                "then run: source api-tests/scripts/local-env.sh"
            )
        settings = cls(
            supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
            anon_key=os.environ["SUPABASE_ANON_KEY"],
            service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            jwt_secret=os.environ["SUPABASE_JWT_SECRET"],
            db_url=os.environ["SUPABASE_DB_URL"],
            functions_url=_optional_url("FITLOG_FUNCTIONS_URL"),
            stub_url=_optional_url("FITLOG_STUB_URL"),
        )
        for name, url in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_DB_URL", settings.db_url),
            ("FITLOG_FUNCTIONS_URL", settings.functions_url),
            ("FITLOG_STUB_URL", settings.stub_url),
        ):
            if url is not None:
                _require_local(name, url)
        return settings


def _optional_url(name: str) -> str | None:
    value = os.environ.get(name)
    return value.rstrip("/") if value else None


def _require_local(name: str, url: str) -> None:
    host = urlparse(url).hostname
    if host not in LOCAL_HOSTS:
        raise ConfigError(f"{name} must point at the local test stack, got host {host!r}")
