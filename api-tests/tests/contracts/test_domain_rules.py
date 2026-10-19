"""Domain rules the app relies on, checked through the API.

Diary snapshots that survive a food being deleted, the cascades and soft
deletes behind "delete workout", "delete recipe" and "delete routine", and the
defaults a brand-new account starts with.
"""

import json

from testkit import models as m
from testkit.auth import SignedInUser
from testkit.factories import create_row
from testkit.models import parse_error, parse_rows
from testkit.rest import RestClient, Row
from testkit.tables import TABLES_BY_NAME

# -- profile ---------------------------------------------------------------------


def test_new_users_get_one_profile_with_the_documented_defaults(
    fresh_api: RestClient, fresh_user: SignedInUser
) -> None:
    (profile,) = parse_rows(m.Profile, fresh_api.select("profiles"))

    assert str(profile.id) == fresh_user.id
    assert profile.activity_level == "moderate"
    assert profile.goal_type == "maintain"
    assert profile.calorie_goal_mode == "calculated"
    assert profile.macro_targets["carb"] == {"mode": "remainder"}
    assert profile.calorie_goal_history == []
    assert profile.trainer_memory == []
    assert profile.coach_enabled is False


def test_a_second_profile_cannot_be_created(
    fresh_api: RestClient, fresh_user: SignedInUser
) -> None:
    resp = fresh_api.insert("profiles", {"id": fresh_user.id})

    assert resp.status_code == 409
    assert parse_error(resp).code == "23505"  # unique (primary key)


# -- foods, recipes and the diary ----------------------------------------------------


def test_new_foods_default_to_one_manual_serving(owner_api: RestClient) -> None:
    food = m.Food.model_validate_json(_json(owner_api.create("foods", {"name": "Plain rice"})))

    assert (food.source, food.serving_qty, food.serving_unit) == ("manual", 1, "serving")
    assert food.nutrients == {}
    assert food.archived is False


def test_archiving_a_food_keeps_it_in_the_library(owner_api: RestClient) -> None:
    """The app's "Delete food" is a soft delete."""
    food = create_row(owner_api, TABLES_BY_NAME["foods"])

    owner_api.update("foods", {"archived": True}, {"id": food["id"]})

    stored = owner_api.row("foods", food["id"])
    assert stored is not None
    assert stored["archived"] is True


def test_deleting_a_food_keeps_the_diary_snapshot(owner_api: RestClient) -> None:
    """Logged days must never change when a food is later edited or deleted."""
    food = owner_api.create("foods", {"name": "Bagel", "nutrients": {"kcal": 280, "protein": 10}})
    entry = owner_api.create(
        "diary_entries",
        {
            "entry_date": "2025-02-01",
            "food_id": food["id"],
            "food_name": "Bagel",
            "nutrients": food["nutrients"],
            "servings": 1.5,
        },
    )

    assert owner_api.delete("foods", {"id": food["id"]}).status_code == 200

    after = owner_api.row("diary_entries", entry["id"])
    assert after is not None
    assert after["food_id"] is None, "the link is cleared (on delete set null)"
    assert (after["food_name"], after["servings"], after["nutrients"]) == (
        "Bagel",
        1.5,
        {"kcal": 280, "protein": 10},
    )


def test_deleting_a_recipe_removes_its_ingredient_links(owner_api: RestClient) -> None:
    link = create_row(owner_api, TABLES_BY_NAME["recipe_ingredients"])

    owner_api.delete("foods", {"id": link["recipe_food_id"]})

    assert owner_api.row("recipe_ingredients", link["id"]) is None
    assert owner_api.row("foods", link["ingredient_food_id"]) is not None


def test_a_food_used_in_a_recipe_cannot_be_hard_deleted(owner_api: RestClient) -> None:
    """ON DELETE RESTRICT on the ingredient side: the app archives such foods instead."""
    link = create_row(owner_api, TABLES_BY_NAME["recipe_ingredients"])

    resp = owner_api.delete("foods", {"id": link["ingredient_food_id"]})

    assert resp.status_code == 409
    assert parse_error(resp).code == "23503"  # foreign key violation


# -- strength ------------------------------------------------------------------------


def test_new_workouts_start_in_progress_with_a_90s_rest(owner_api: RestClient) -> None:
    workout = m.Workout.model_validate_json(
        _json(owner_api.create("workouts", {"workout_date": "2025-03-01"}))
    )

    assert workout.completed is False
    assert workout.rest_seconds == 90


def test_deleting_a_workout_removes_its_exercises_and_sets(owner_api: RestClient) -> None:
    workout = owner_api.create("workouts", {"workout_date": "2025-03-02"})
    exercise = owner_api.create(
        "workout_exercises",
        {"workout_id": workout["id"], "exercise_key": "deadlift", "exercise_name": "Deadlift"},
    )
    lift_set = owner_api.create(
        "workout_sets",
        {
            "workout_id": workout["id"],
            "workout_exercise_id": exercise["id"],
            "exercise_key": "deadlift",
            "exercise_name": "Deadlift",
            "reps": 5,
            "weight_lb": 315,
        },
    )

    owner_api.delete("workouts", {"id": workout["id"]})

    assert owner_api.row("workout_exercises", exercise["id"]) is None
    assert owner_api.row("workout_sets", lift_set["id"]) is None


def test_deleting_a_routine_removes_its_items_and_unlinks_past_workouts(
    owner_api: RestClient,
) -> None:
    item = create_row(owner_api, TABLES_BY_NAME["routine_exercises"])
    workout = owner_api.create(
        "workouts", {"workout_date": "2025-03-03", "source_routine_id": item["routine_id"]}
    )

    owner_api.delete("routines", {"id": item["routine_id"]})

    assert owner_api.row("routine_exercises", item["id"]) is None
    kept = owner_api.row("workouts", workout["id"])
    assert kept is not None, "history is kept"
    assert kept["source_routine_id"] is None


# -- saved meals ---------------------------------------------------------------------


def test_deleting_a_saved_meal_removes_its_items(owner_api: RestClient) -> None:
    item = create_row(owner_api, TABLES_BY_NAME["meal_items"])

    owner_api.delete("meals", {"id": item["meal_id"]})

    assert owner_api.row("meal_items", item["id"]) is None


def _json(row: Row) -> str:
    return json.dumps(row)
