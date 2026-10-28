"""Grounding, the deterministic part: does the trainer get the user's true numbers?

The model can only be as right as the snapshot it is sent. Each test seeds a
fresh synthetic user (deleted when the test ends), builds the snapshot with the
app's own code (src/lib/trainerContext.ts, through the harness), and checks it
against the ground truth worked out independently from the same rows
(aievals/facts.py): every fact stated, stated correctly, nothing else, and
what the snapshot leaves out (foods, single days) really left out, so the live
tier's "missing data" cases ask for something the model truly can't see.
Whether the model then uses the numbers honestly is the live tier's job.
"""

import re
import secrets
from collections.abc import Callable, Iterator
from datetime import date, timedelta

import httpx
import pytest

from aievals.dataset import Dataset, FoodLogged, Persona
from aievals.facts import Facts, ground_truth
from aievals.harness import ClientHarness, TrainerInput
from aievals.personas import PersonaUser, seed_persona
from testkit.anthropic_stub import AnthropicStub
from testkit.auth import AdminAuth, AuthClient
from testkit.config import Settings
from testkit.functions import FunctionsClient
from testkit.models import ClaudeRequest
from testkit.rest import RestClient
from testkit.users import UserFactory

Seeded = tuple[PersonaUser, TrainerInput, Facts]


@pytest.fixture
def seed(
    http: httpx.Client, settings: Settings, harness: ClientHarness
) -> Iterator[Callable[[Persona], Seeded]]:
    """seed(persona) -> a fresh user holding it, their snapshot and the ground truth.

    Every user is deleted when the test ends, pass or fail (which cascades to all
    of their rows), so no test reads another's data.
    """
    users = UserFactory(
        AdminAuth(http, settings.supabase_url, settings.service_role_key),
        AuthClient(http, settings.supabase_url, settings.anon_key),
        f"gr{secrets.token_hex(3)}",
    )

    def make(persona: Persona) -> Seeded:
        today = date.today()
        user = users.create("grounding")
        api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
        seed_persona(api, user.id, persona, today)
        return (
            PersonaUser(user, api, persona),
            harness.trainer_input(user),
            ground_truth(persona, today),
        )

    yield make
    users.delete_all()


@pytest.fixture
def riley(dataset: Dataset) -> Persona:
    return dataset.personas["riley"]


def snapshot_lines(f: Facts, p: Persona) -> list[str]:
    """What the snapshot should say about Riley, line by line, from the ground truth."""
    day = {
        w.days_ago: (date.fromisoformat(f.today) - timedelta(days=w.days_ago)).isoformat()
        for w in p.workouts
    }
    newest = min(p.workouts, key=lambda w: w.days_ago)
    micros = ", ".join(
        f"{label} {f[f'micro_{key}_pct']:.0f}%"
        for key, label in (
            ("fiber", "Fiber"),
            ("iron", "Iron"),
            ("calcium", "Calcium"),
            ("vit_d", "Vitamin D"),
            ("potassium", "Potassium"),
            ("magnesium", "Magnesium"),
            ("zinc", "Zinc"),
            ("b12", "Vitamin B12"),
        )
    )
    return [
        f"Today is {f.today}.",
        f"Lifter: {f['age']:.0f}y, {p.profile.sex}, {f['height_cm']:.0f} cm, "
        f"{f['weight_lb']:.0f} lb.",
        f"Bodyweight down {f['weight_delta_lb']:.1f} lb "
        f"over the last {f['weight_span_days']:.0f} days.",
        f"Lifting sessions: {f['lift_sessions_90']:.0f} in the last 90 days, "
        f"{f['lift_sessions_14']:.0f} in the last 14. Most recent was {day[newest.days_ago]} "
        f"({newest.name}).",
        "Program rotation: Full Body A → Full Body B.",
        f"Goblet Squat — best est 1RM {f['Goblet Squat best est 1RM']:.0f} lb",
        f"    {day[2]}: 50x10, 50x10, 50x10",
        f"Cardio in the last 14 days: {f['cardio_sessions']:.0f} sessions, "
        f"{f['cardio_min']:.0f} min total (Incline walk, Cycling).",
        f"Calorie goal: {f['goal_kcal']:.0f}/day (manual, cutting at 1 lb/week).",
        f"Macro targets: {f['protein_target_g']:.0f} g protein, {f['carb_target_g']:.0f} g carb, "
        f"{f['fat_target_g']:.0f} g fat.",
        f"Food logged on {f['logged28']:.0f} of the last 28 days. On those days: "
        f"{f['avg28_kcal']:.0f} kcal, {f['avg28_protein']:.0f} g protein "
        f"({f['protein_g_per_lb']:.2f} g/lb bodyweight), {f['avg28_carb']:.0f} g carb, "
        f"{f['avg28_fat']:.0f} g fat per day.",
        f"Last 7 days ({f['logged7']:.0f} logged): {f['avg7_kcal']:.0f} kcal, "
        f"{f['avg7_protein']:.0f} g protein per day.",
        f"Measured maintenance (from intake vs weight change): {f['tdee_kcal']:.0f} kcal/day, "
        f"weight trending -{f['trend_lb_week']:.2f} lb/week.",
        f"Micronutrients, average % Daily Value on logged days: {micros}.",
        "Takes these daily supplements (logged outside the diary, so their micros are NOT in the "
        "numbers above): Vitamin D3.",
    ]


def test_the_snapshot_states_every_fact_correctly(
    seed: Callable[[Persona], Seeded], riley: Persona
) -> None:
    _, given, facts = seed(riley)
    missing = [line for line in snapshot_lines(facts, riley) if line not in given.context]
    assert missing == [], f"not in the snapshot as stated:\n{given.context}"


def test_every_number_in_the_snapshot_is_a_seeded_fact(
    seed: Callable[[Persona], Seeded], riley: Persona
) -> None:
    """The other direction: nothing in the snapshot that the rows don't say."""
    _, given, facts = seed(riley)
    text = re.sub(r"\b20\d\d-\d\d-\d\d\b", " ", given.context)
    for name in sorted(facts.names, key=len, reverse=True):
        text = text.replace(name, " ")
    true = [f.value for f in facts.visible()]
    numbers = [float(n) for n in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text)]
    strays = sorted({n for n in numbers if not any(abs(n - t) < 1e-9 for t in true)})
    assert strays == [], f"numbers the seeded rows don't support: {strays}\n{given.context}"


def test_foods_and_single_days_stay_out_of_the_snapshot(
    seed: Callable[[Persona], Seeded], riley: Persona
) -> None:
    """So the live tier's "missing data" cases really ask for what the model can't see."""
    _, given, facts = seed(riley)
    named = [food for food in facts.foods if food.lower() in given.context.lower()]
    assert named == []
    assert not re.search(r"\b(?:breakfast|lunch|dinner|snack)", given.context, re.IGNORECASE)


def test_the_snapshot_reaches_claude_whole_inside_its_data_block(
    seed: Callable[[Persona], Seeded],
    riley: Persona,
    functions: FunctionsClient,
    claude: AnthropicStub,
) -> None:
    user, given, _ = seed(riley)
    functions.as_user(user.user.access_token).ask_trainer(
        "How am I doing?", context=given.context, memory=given.memory
    )
    system = ClaudeRequest.model_validate(claude.only_call().body).system or ""
    assert f"<training_log>\n{given.context}\n</training_log>" in system
    assert "- Works night shifts three days a week" in system


# -- the edges: each a small change to Riley, so one rule is tested at a time ------------


def with_log(persona: Persona, rows: list[FoodLogged]) -> Persona:
    return persona.model_copy(update={"food_log": rows})


def test_servings_multiply_the_per_serving_nutrients(
    seed: Callable[[Persona], Seeded], riley: Persona
) -> None:
    _, given, facts = seed(
        with_log(riley, [FoodLogged(days_ago=1, meal="dinner", food="Burrito bowl", servings=2.5)])
    )
    assert facts["avg28_kcal"] == 1900  # 760 x 2.5
    assert "Food logged on 1 of the last 28 days. On those days: 1900 kcal" in given.context


def test_a_day_of_zero_calories_is_not_a_logged_day(
    seed: Callable[[Persona], Seeded], riley: Persona
) -> None:
    _, given, _ = seed(
        with_log(
            riley,
            [
                FoodLogged(days_ago=1, meal="lunch", food="Lentil soup"),
                FoodLogged(days_ago=2, meal="breakfast", food="Black coffee"),
            ],
        )
    )
    assert "Food logged on 1 of the last 28 days. On those days: 320 kcal" in given.context


def test_the_last_28_days_are_28_days(seed: Callable[[Persona], Seeded], riley: Persona) -> None:
    """Someone who logged every day must never read "29 of the last 28 days"."""
    every_day = [FoodLogged(days_ago=d, meal="lunch", food="Lentil soup") for d in range(0, 40)]
    _, given, facts = seed(with_log(riley, every_day))
    assert facts["logged28"] == 28
    assert "Food logged on 28 of the last 28 days." in given.context, given.context


def test_the_last_7_days_are_7_days(seed: Callable[[Persona], Seeded], riley: Persona) -> None:
    every_day = [FoodLogged(days_ago=d, meal="lunch", food="Lentil soup") for d in range(0, 40)]
    _, given, facts = seed(with_log(riley, every_day))
    assert facts["logged7"] == 7
    assert "Last 7 days (7 logged)" in given.context, given.context


def test_a_test_user_is_gone_once_its_test_ends(
    http: httpx.Client, settings: Settings, harness: ClientHarness, riley: Persona
) -> None:
    """The per-test cleanup above, checked: a deleted user's rows go with it."""
    admin = AdminAuth(http, settings.supabase_url, settings.service_role_key)
    users = UserFactory(admin, AuthClient(http, settings.supabase_url, settings.anon_key), "grdel")
    user = users.create("grounding")
    seed_persona(
        RestClient(http, settings.supabase_url, settings.anon_key, user.access_token),
        user.id,
        riley,
        date.today(),
    )
    service = RestClient(
        http, settings.supabase_url, settings.service_role_key, settings.service_role_key
    )
    assert service.select("diary_entries", {"user_id": user.id}).json(), "nothing was seeded"
    users.delete_all()
    left = service.select("diary_entries", {"user_id": user.id})
    assert left.status_code == 200
    assert left.json() == []
