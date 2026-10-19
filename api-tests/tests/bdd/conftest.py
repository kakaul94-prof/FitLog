"""Step definitions for the feature files in tests/bdd/features.

Each step is one API call or one check. Steps share state through `world`:
who is who, what they saved and the last response. Every scenario signs up
fresh users, so a scenario reads exactly like the data it runs on.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from uuid import uuid4

import httpx
import pytest
from pytest_bdd import given, parsers, then, when

from testkit.auth import SignedInUser
from testkit.factories import create_row
from testkit.models import parse_error
from testkit.rest import RestClient, Row
from testkit.storage import StorageClient, effective_status
from testkit.tables import TABLES_BY_NAME
from testkit.users import UserFactory

DAY = "2025-01-15"

# The words a scenario uses for a kind of record -> the table that holds it.
RECORDS = {
    "diary entries": "diary_entries",
    "foods": "foods",
    "workouts": "workouts",
    "workout sets": "workout_sets",
    "weigh-ins": "measurements",
    "saved meals": "meals",
    "exercise notes": "exercise_notes",
    "strength goals": "strength_goals",
}


@dataclass(frozen=True)
class Person:
    user: SignedInUser
    api: RestClient
    storage: StorageClient


@dataclass
class World:
    people: dict[str, Person] = field(default_factory=dict)
    saved: dict[str, Row] = field(default_factory=dict)  # "Alice's foods" -> the row
    uploads: list[tuple[Person, str]] = field(default_factory=list)
    last: httpx.Response | None = None
    subject: str = ""  # who "she" is in a single-person journey

    def __getitem__(self, name: str) -> Person:
        return self.people[name]

    @property
    def her(self) -> Person:
        return self.people[self.subject]

    def response(self) -> httpx.Response:
        assert self.last is not None, "no request has been made yet"
        return self.last


@pytest.fixture
def world() -> Iterator[World]:
    state = World()
    yield state
    for person, path in state.uploads:
        person.storage.remove("form-videos", [path])


def _sign_up(
    world: World, name: str, users: UserFactory, api: RestClient, st: StorageClient
) -> None:
    user = users.create(name.lower())
    world.people[name] = Person(user, api.as_user(user.access_token), st.as_user(user.access_token))
    world.subject = world.subject or name


def _food_named(person: Person, name: str) -> Row:
    (food,) = person.api.rows("foods", {"name": name})
    return food


# -- people -----------------------------------------------------------------------------


@given("Alice and Bob each have a FitLog account")
def alice_and_bob(
    world: World, users: UserFactory, anon_api: RestClient, anon_storage: StorageClient
) -> None:
    for name in ("Alice", "Bob"):
        _sign_up(world, name, users, anon_api, anon_storage)


@given(parsers.parse("{name} has a FitLog account"))
def one_account(
    world: World, name: str, users: UserFactory, anon_api: RestClient, anon_storage: StorageClient
) -> None:
    _sign_up(world, name, users, anon_api, anon_storage)


# -- the food diary ---------------------------------------------------------------------


@given(parsers.parse('{name} has a food "{food}"'))
def has_food(world: World, name: str, food: str) -> None:
    saved = world[name].api.create("foods", {"name": food})
    world.saved[f"{name}'s {food}"] = world.saved[f"{name}'s food"] = saved


@given(parsers.parse('{name} has a food "{food}" with {kcal:d} kcal per serving'))
def has_food_with_kcal(world: World, name: str, food: str, kcal: int) -> None:
    world[name].api.create("foods", {"name": food, "nutrients": {"kcal": kcal}})


@given(parsers.parse('{name} has logged "{food}" for {meal}'))
def has_logged(world: World, name: str, food: str, meal: str) -> None:
    api = world[name].api
    saved = api.create("foods", {"name": food, "nutrients": {"kcal": 150}})
    entry = {"entry_date": DAY, "meal": meal, "food_name": food, "food_id": saved["id"]}
    api.create("diary_entries", entry | {"nutrients": saved["nutrients"]})


@when(parsers.parse('she logs {servings:g} servings of "{food}" for {meal} on {day}'))
def she_logs(world: World, servings: float, food: str, meal: str, day: str) -> None:
    saved = _food_named(world.her, food)
    entry = {"entry_date": day, "meal": meal, "food_name": food, "food_id": saved["id"]}
    world.her.api.create(
        "diary_entries", entry | {"servings": servings, "nutrients": saved["nutrients"]}
    )


DIARY_SHOWS = 'her diary for {day} shows "{food}" with {servings:g} servings and {kcal:d} kcal'


@then(parsers.parse(DIARY_SHOWS + " per serving"))
@then(parsers.parse(DIARY_SHOWS.replace(" shows ", " still shows ") + " per serving"))
def her_diary_shows(world: World, day: str, food: str, servings: float, kcal: int) -> None:
    (entry,) = world.her.api.rows("diary_entries", {"entry_date": day})
    logged = (entry["food_name"], entry["servings"], entry["nutrients"]["kcal"])
    assert logged == (food, servings, kcal)


@when(parsers.parse('she deletes "{food}" from her food library'))
def she_deletes_food(world: World, food: str) -> None:
    resp = world.her.api.delete("foods", {"id": _food_named(world.her, food)["id"]})
    assert resp.status_code == 200, resp.text


@when(parsers.parse('{name} searches {pronoun} foods for "{text}"'))
def searches_foods(world: World, name: str, pronoun: str, text: str) -> None:
    world.last = world[name].api.search("foods", "name", text)


@when(parsers.parse('{name} searches {pronoun} diary for "{text}"'))
def searches_diary(world: World, name: str, pronoun: str, text: str) -> None:
    world.last = world[name].api.search("diary_entries", "food_name", text)


@then(parsers.parse('{name}\'s diary still has "{food}" for {meal}'))
def diary_still_has(world: World, name: str, food: str, meal: str) -> None:
    rows = world[name].api.rows("diary_entries", {"food_name": food, "meal": meal})
    assert len(rows) == 1


# -- recipes ------------------------------------------------------------------------------


@when(parsers.parse('she makes a recipe "{recipe}" from "{first}" and "{second}"'))
def she_makes_recipe(world: World, recipe: str, first: str, second: str) -> None:
    api = world.her.api
    made = api.create("foods", {"name": recipe, "source": "recipe", "recipe_servings": 12})
    for position, ingredient in enumerate((first, second)):
        link = {
            "recipe_food_id": made["id"],
            "ingredient_food_id": _food_named(world.her, ingredient)["id"],
            "position": position,
        }
        api.create("recipe_ingredients", link)


@then(parsers.parse('"{recipe}" lists {count:d} ingredients'))
def recipe_lists(world: World, recipe: str, count: int) -> None:
    links = world.her.api.rows(
        "recipe_ingredients", {"recipe_food_id": _food_named(world.her, recipe)["id"]}
    )
    assert len(links) == count


@then(parsers.parse('"{food}" can\'t be deleted while "{recipe}" uses it'))
def cannot_delete_ingredient(world: World, food: str, recipe: str) -> None:
    resp = world.her.api.delete("foods", {"id": _food_named(world.her, food)["id"]})
    assert resp.status_code == 409
    assert parse_error(resp).code == "23503"  # still referenced


@when(parsers.parse('she deletes the recipe "{recipe}"'))
def she_deletes_recipe(world: World, recipe: str) -> None:
    world.her.api.delete("foods", {"id": _food_named(world.her, recipe)["id"]})


@then(parsers.parse('"{food}" can be deleted'))
def can_delete(world: World, food: str) -> None:
    resp = world.her.api.delete("foods", {"id": _food_named(world.her, food)["id"]})
    assert resp.status_code == 200
    assert resp.json(), "one row deleted"


# -- training -----------------------------------------------------------------------------


@given(parsers.parse("{name} has a workout"))
def has_workout(world: World, name: str) -> None:
    world.saved[f"{name}'s workout"] = create_row(world[name].api, TABLES_BY_NAME["workouts"])


@when(parsers.parse("she starts a workout on {day}"))
def she_starts_workout(world: World, day: str) -> None:
    world.saved["workout"] = world.her.api.create("workouts", {"workout_date": day})


@when(parsers.parse('she logs {sets:d} sets of {reps:d} "{exercise}" at {weight:g} lb'))
def she_logs_sets(world: World, sets: int, reps: int, exercise: str, weight: float) -> None:
    api, workout = world.her.api, world.saved["workout"]
    key = exercise.lower().replace(" ", "_")
    block = api.create(
        "workout_exercises",
        {"workout_id": workout["id"], "exercise_key": key, "exercise_name": exercise},
    )
    lift = {"exercise_key": key, "exercise_name": exercise, "reps": reps, "weight_lb": weight}
    for number in range(1, sets + 1):
        parent = {"workout_id": workout["id"], "workout_exercise_id": block["id"]}
        api.create("workout_sets", parent | lift | {"set_number": number})


@when("she marks the workout as done")
def she_finishes(world: World) -> None:
    world.her.api.update("workouts", {"completed": True}, {"id": world.saved["workout"]["id"]})


@then(parsers.parse("the workout is complete with {count:d} sets"))
def workout_complete(world: World, count: int) -> None:
    workout_id = world.saved["workout"]["id"]
    workout = world.her.api.row("workouts", workout_id)
    assert workout is not None
    assert workout["completed"] is True
    assert len(world.her.api.rows("workout_sets", {"workout_id": workout_id})) == count


@when("she deletes the workout")
def she_deletes_workout(world: World) -> None:
    world.her.api.delete("workouts", {"id": world.saved["workout"]["id"]})


@then("its sets are gone too")
def sets_gone(world: World) -> None:
    assert world.her.api.rows("workout_sets", {"workout_id": world.saved["workout"]["id"]}) == []


@when(parsers.parse("{actor} logs a set against {owner}'s workout"))
def logs_set_against(world: World, actor: str, owner: str) -> None:
    world.saved[f"{actor}'s sets before"] = {"rows": world[actor].api.rows("workout_sets")}
    their_workout = world.saved[f"{owner}'s workout"]["id"]
    lift = {"exercise_key": "deadlift", "exercise_name": "Deadlift", "reps": 1, "weight_lb": 500}
    world.last = world[actor].api.insert("workout_sets", {"workout_id": their_workout} | lift)


@when(parsers.parse("{name} deletes her workout"))
def deletes_her_workout(world: World, name: str) -> None:
    world[name].api.delete("workouts", {"id": world.saved[f"{name}'s workout"]["id"]})


@then(parsers.parse("{name}'s own sets are untouched"))
def own_sets_untouched(world: World, name: str) -> None:
    assert world[name].api.rows("workout_sets") == world.saved[f"{name}'s sets before"]["rows"]


@when(parsers.parse("{actor} adds {owner}'s food to one of his recipes"))
def adds_to_recipe(world: World, actor: str, owner: str) -> None:
    api = world[actor].api
    recipe = api.create("foods", {"name": "Copycat stew", "source": "recipe"})
    victims_food = world.saved[f"{owner}'s food"]
    world.last = api.insert(
        "recipe_ingredients",
        {"recipe_food_id": recipe["id"], "ingredient_food_id": victims_food["id"]},
    )


@then(parsers.parse('{name} can still delete "{food}"'))
def can_still_delete(world: World, name: str, food: str) -> None:
    resp = world[name].api.delete("foods", {"id": world.saved[f"{name}'s {food}"]["id"]})
    assert resp.status_code == 200, resp.text


# -- body ---------------------------------------------------------------------------------


@when(parsers.parse("she logs a weigh-in of {lb:g} lb on {day}"))
def she_weighs_in(world: World, lb: float, day: str) -> None:
    world.her.api.create("measurements", {"measured_on": day, "value": lb})


@when(parsers.parse("she sets a manual calorie goal of {kcal:d} kcal"))
def she_sets_goal(world: World, kcal: int) -> None:
    resp = world.her.api.update(
        "profiles",
        {"calorie_goal_mode": "manual", "manual_calorie_goal": kcal},
        {"id": world.her.user.id},
    )
    assert resp.status_code == 200, resp.text


@then(parsers.parse("her latest weigh-in is {lb:g} lb"))
def latest_weigh_in(world: World, lb: float) -> None:
    rows = world.her.api.rows("measurements", {"type": "weight"})
    assert max(rows, key=lambda r: r["measured_on"])["value"] == lb


@then(parsers.parse("her profile uses a manual goal of {kcal:d} kcal"))
def profile_goal(world: World, kcal: int) -> None:
    (profile,) = world.her.api.rows("profiles")
    assert (profile["calorie_goal_mode"], profile["manual_calorie_goal"]) == ("manual", kcal)


@when(parsers.parse("{actor} saves a weigh-in of {lb:g} lb into {owner}'s account"))
def saves_weigh_in_for(world: World, actor: str, lb: float, owner: str) -> None:
    world.last = world[actor].api.insert(
        "measurements", {"measured_on": DAY, "value": lb, "user_id": world[owner].user.id}
    )


@then(parsers.parse("{name} has no weigh-ins"))
def no_weigh_ins(world: World, name: str) -> None:
    assert world[name].api.rows("measurements") == []


# -- any kind of record -------------------------------------------------------------------


@given(parsers.parse("{name} has {records} saved"))
def has_records(world: World, name: str, records: str) -> None:
    world.saved[f"{name}'s {records}"] = create_row(
        world[name].api, TABLES_BY_NAME[RECORDS[records]]
    )


@when(parsers.parse("{actor} tries to read {owner}'s {records}"))
def tries_to_read(world: World, actor: str, owner: str, records: str) -> None:
    row = world.saved[f"{owner}'s {records}"]
    world.last = world[actor].api.select(RECORDS[records], {"id": row["id"]})


@when(parsers.parse("{actor} tries to change {owner}'s {records}"))
def tries_to_change(world: World, actor: str, owner: str, records: str) -> None:
    table = TABLES_BY_NAME[RECORDS[records]]
    column, value = table.edit
    world.last = world[actor].api.update(
        table.name, {column: value}, {"id": world.saved[f"{owner}'s {records}"]["id"]}
    )


@when(parsers.parse("{actor} tries to delete {owner}'s {records}"))
def tries_to_delete(world: World, actor: str, owner: str, records: str) -> None:
    world.last = world[actor].api.delete(
        RECORDS[records], {"id": world.saved[f"{owner}'s {records}"]["id"]}
    )


@then(parsers.parse("{owner}'s {records} are exactly as she left them"))
def exactly_as_left(world: World, owner: str, records: str) -> None:
    row = world.saved[f"{owner}'s {records}"]
    assert world[owner].api.row(RECORDS[records], row["id"]) == row


# -- form-check videos --------------------------------------------------------------------


@given(parsers.parse("{name} has uploaded a form-check video"))
def has_video(world: World, name: str) -> None:
    person = world[name]
    path = f"{person.user.id}/{uuid4().hex}.mp4"
    assert (
        person.storage.upload("form-videos", path, b"\x00\x00\x00\x18ftypmp42").status_code == 200
    )
    world.uploads.append((person, path))


@when(parsers.parse("{actor} tries to download {owner}'s video"))
def tries_to_download(world: World, actor: str, owner: str) -> None:
    (_, path) = next(u for u in world.uploads if u[0] is world[owner])
    world.last = world[actor].storage.download("form-videos", path)


@when(parsers.parse("{actor} lists {owner}'s video folder"))
def lists_folder(world: World, actor: str, owner: str) -> None:
    world.last = world[actor].storage.list_folder("form-videos", world[owner].user.id)


@then("the video is not found")
def video_not_found(world: World) -> None:
    assert effective_status(world.response()) == 404


# -- signed-out visitors ------------------------------------------------------------------


@when("a signed-out visitor reads the diary")
def visitor_reads(world: World, anon_api: RestClient) -> None:
    world.last = anon_api.select("diary_entries")


@when(parsers.parse('a signed-out visitor tries to log "{food}" for {meal}'))
def visitor_logs(world: World, anon_api: RestClient, food: str, meal: str) -> None:
    world.last = anon_api.insert(
        "diary_entries", {"entry_date": DAY, "meal": meal, "food_name": food}
    )


# -- outcomes -----------------------------------------------------------------------------


@then(parsers.parse("{who} finds nothing"))
def finds_nothing(world: World, who: str) -> None:
    resp = world.response()
    assert (resp.status_code, resp.json()) == (200, [])


@then("the API refuses it as a row-level security violation")
def refused_by_rls(world: World) -> None:
    resp = world.response()
    assert resp.status_code in {401, 403}
    assert parse_error(resp).code == "42501"


@then(parsers.parse("the API refuses the link to {owner}'s {thing}"))
def refused_link(world: World, owner: str, thing: str) -> None:
    resp = world.response()
    assert resp.status_code == 409, resp.text
    assert parse_error(resp).code == "23503"  # no such (row, owner) pair
