"""Tier 1 fixtures: the local stack, the functions server with the Claude stub,
seeded personas and the Node harness that runs the app's own trainer client code.

Nothing here talks to the real Claude API. Every user is created for this run,
seeded with a synthetic persona from dataset/personas.yaml, and deleted at the
end (which cascades to all of their rows).
"""

import os
import secrets
from collections.abc import Iterator, Mapping
from datetime import date
from typing import NoReturn

import httpx
import pytest

from aievals.dataset import Dataset, Persona, SeedKind, load_dataset
from aievals.harness import ClientHarness, TrainerInput
from aievals.personas import MakePersonaUser, PersonaUser, seed_persona, with_seed
from testkit.anthropic_stub import AnthropicStub
from testkit.auth import AdminAuth, AuthClient
from testkit.config import FAKE_ANTHROPIC_KEY, Settings
from testkit.functions import FunctionsClient
from testkit.rest import RestClient
from testkit.users import UserFactory

# -- configuration and clients -----------------------------------------------------


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env()


@pytest.fixture(scope="session")
def http() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=30) as client:
        yield client


@pytest.fixture(scope="session")
def dataset() -> Dataset:
    return load_dataset()


@pytest.fixture(scope="session")
def harness(settings: Settings) -> ClientHarness:
    ClientHarness.build()
    return ClientHarness(settings.supabase_url, settings.anon_key)


@pytest.fixture(scope="session")
def server_secrets(settings: Settings) -> dict[str, str]:
    """Values that must never reach Claude or the browser."""
    return {
        "Claude API key": FAKE_ANTHROPIC_KEY,
        "Supabase service-role key": settings.service_role_key,
        "Supabase JWT secret": settings.jwt_secret,
        "database URL": settings.db_url,
    }


# -- users and personas ------------------------------------------------------------------


@pytest.fixture(scope="session")
def users(http: httpx.Client, settings: Settings) -> Iterator[UserFactory]:
    auth = AuthClient(http, settings.supabase_url, settings.anon_key)
    admin = AdminAuth(http, settings.supabase_url, settings.service_role_key)
    factory = UserFactory(admin, auth, f"ai{secrets.token_hex(3)}")
    yield factory
    factory.delete_all()


@pytest.fixture(scope="session")
def make_persona_user(
    http: httpx.Client, settings: Settings, users: UserFactory, dataset: Dataset
) -> MakePersonaUser:
    """make(persona="sam", seed={}) -> a fresh user seeded with that persona."""

    def make(
        persona: str | Persona = "sam", seed: Mapping[SeedKind, str] | None = None
    ) -> PersonaUser:
        base = dataset.personas[persona] if isinstance(persona, str) else persona
        full = with_seed(base, seed or {})
        user = users.create(persona if isinstance(persona, str) else "persona")
        api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
        seed_persona(api, user.id, full, date.today())
        return PersonaUser(user, api, full)

    return make


@pytest.fixture(scope="session")
def sam(make_persona_user: MakePersonaUser) -> PersonaUser:
    return make_persona_user("sam")


@pytest.fixture(scope="session")
def jordan(make_persona_user: MakePersonaUser) -> PersonaUser:
    return make_persona_user("jordan")


@pytest.fixture(scope="session")
def sam_input(harness: ClientHarness, sam: PersonaUser) -> TrainerInput:
    """What the browser would post for Sam: the real snapshot plus saved memory."""
    return harness.trainer_input(sam.user)


# -- the functions server and the Claude stub ---------------------------------------


def _functions_server_missing() -> NoReturn:
    message = (
        "The Pages Functions server isn't running. Start it with "
        "`bash api-tests/scripts/start-functions.sh --bg` and export what it prints "
        "(or run `make test-ai`, which does both)."
    )
    # In CI a skipped test would be a silent gap, so it's an error there.
    if os.environ.get("CI"):
        pytest.fail(message, pytrace=False)
    pytest.skip(message)


@pytest.fixture(scope="session")
def functions(http: httpx.Client, settings: Settings) -> FunctionsClient:
    if settings.functions_url is None:
        _functions_server_missing()
    return FunctionsClient(http, settings.functions_url)


@pytest.fixture(scope="session")
def stub(http: httpx.Client, settings: Settings) -> AnthropicStub:
    if settings.stub_url is None:
        _functions_server_missing()
    return AnthropicStub(http, settings.stub_url)


@pytest.fixture
def claude(stub: AnthropicStub) -> AnthropicStub:
    """The recording stand-in for the Claude API, emptied before each test."""
    stub.reset()
    return stub


@pytest.fixture(scope="session")
def trainer(functions: FunctionsClient, sam: PersonaUser) -> FunctionsClient:
    """/api/trainer, called as Sam."""
    return functions.as_user(sam.user.access_token)


# -- reporting ---------------------------------------------------------------------------

# Test module -> the category it reports under in Allure ("Behaviors" view).
CATEGORIES = {
    "test_prompt_injection": "Prompt injection",
    "test_information_exposure": "Information exposure",
    "test_unintended_actions": "Unintended actions",
    "test_output_fidelity": "Incorrect outputs",
    "test_dependency_failures": "Dependency failure",
    "test_grounding": "Grounding",
    "test_checks": "Eval harness",
    "test_dataset": "Eval harness",
    "test_factcheck": "Eval harness",
}


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        category = CATEGORIES.get(item.path.stem)
        if category:
            item.add_marker(pytest.mark.allure_label(category, label_type="feature"))
