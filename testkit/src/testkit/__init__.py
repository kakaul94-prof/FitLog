"""Reusable building blocks for testing FitLog's backend.

Nothing in here asserts anything: these are the clients, data builders and
helpers that test suites are written with. Install it into a suite's
environment with `pip install -e ./testkit` (from the repository root).

    config          where the suite points; refuses anything but a local stack
    auth            Supabase Auth (GoTrue) client + service-role user admin
    rest            PostgREST client (the app's database API)
    storage         Supabase Storage client (form-check videos)
    functions       client for the Cloudflare Pages Functions under /api
    tokens          hand-made JWTs: expired, forged, tampered, unsigned
    users           per-run test users, deleted (with all their rows) at the end
    tables          the registry of per-user tables every isolation test runs over
    factories       builds valid rows for any table, parents first
    models          pydantic response contracts
    db              psycopg helpers that act as a user, to test RLS policies directly
    leaks           scans a response for secrets, internals and other users' data
    anthropic_stub  a recording stand-in for the Claude API

The public API is every name in `__all__` below, plus `testkit.models` and
`testkit.anthropic_stub` (`AnthropicStub`, `Reply`, `RecordedCall`), which are
imported from their modules: the stub module is also run as a server
(`python -m testkit.anthropic_stub`), so the package doesn't import it. Public
names keep working across minor versions (see CHANGELOG.md); anything else can
change without notice.
"""

from testkit.auth import AdminAuth, AuthClient, SignedInUser
from testkit.config import FAKE_ANTHROPIC_KEY, ConfigError, Settings
from testkit.db import acting_as, connect, create_auth_user
from testkit.factories import build_row, create_row, db_create_row, db_insert, new_token
from testkit.functions import FunctionsClient, TimedReply, Turn
from testkit.leaks import find_leaks
from testkit.rest import ApiError, RestClient, Row
from testkit.storage import StorageClient, effective_status
from testkit.tables import INSERTABLE, TABLES, TABLES_BY_NAME, RowContext, TableSpec
from testkit.tokens import (
    FORGED_TOKENS,
    TokenForger,
    claims_of,
    make_token,
    unsigned,
    with_claims,
    without_signature,
)
from testkit.users import UserFactory

__version__ = "0.2.0"

__all__ = [
    "FAKE_ANTHROPIC_KEY",
    "FORGED_TOKENS",
    "INSERTABLE",
    "TABLES",
    "TABLES_BY_NAME",
    "AdminAuth",
    "ApiError",
    "AuthClient",
    "ConfigError",
    "FunctionsClient",
    "RestClient",
    "Row",
    "RowContext",
    "Settings",
    "SignedInUser",
    "StorageClient",
    "TableSpec",
    "TimedReply",
    "TokenForger",
    "Turn",
    "UserFactory",
    "__version__",
    "acting_as",
    "build_row",
    "claims_of",
    "connect",
    "create_auth_user",
    "create_row",
    "db_create_row",
    "db_insert",
    "effective_status",
    "find_leaks",
    "make_token",
    "new_token",
    "unsigned",
    "with_claims",
    "without_signature",
]
