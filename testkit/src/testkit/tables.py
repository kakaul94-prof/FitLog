"""The registry of per-user tables that the isolation and contract suites run over.

Each entry says how to build one valid row, which column to change in update
probes and which contract describes the response. Adding a table to FitLog means
adding one `TableSpec` line here: the RLS (API and database), CRUD and contract
tests then cover it automatically, and a catalog test fails until you do.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from testkit import models as m

Row = dict[str, Any]


@dataclass(frozen=True)
class RowContext:
    token: str  # unique per row, for names and per-user unique keys
    parents: Mapping[str, str]  # parent alias -> id of a row the same user created first


@dataclass(frozen=True, eq=False)
class TableSpec:
    name: str
    model: type[m.Contract]
    sample: Callable[[RowContext], Row]
    edit: tuple[str, Any]  # a column and a new value, for update probes
    parents: Mapping[str, str] = field(default_factory=dict)  # alias -> parent table
    owner_column: str = "user_id"
    one_per_user: bool = False  # made by the signup trigger; never inserted by clients

    def __str__(self) -> str:
        return self.name


DAY = "2025-01-15"

# fmt: off
TABLES: tuple[TableSpec, ...] = (
    TableSpec("profiles", m.Profile, lambda c: {}, ("height_cm", 180), owner_column="id", one_per_user=True),
    TableSpec("foods", m.Food, lambda c: {"name": f"Oats {c.token}", "nutrients": {"kcal": 150}}, ("name", "Steel-cut oats")),
    TableSpec("recipe_ingredients", m.RecipeIngredient, lambda c: {"recipe_food_id": c.parents["recipe"], "ingredient_food_id": c.parents["ingredient"]}, ("servings", 2), {"recipe": "foods", "ingredient": "foods"}),
    TableSpec("diary_entries", m.DiaryEntry, lambda c: {"entry_date": DAY, "food_name": f"Banana {c.token}", "nutrients": {"kcal": 105}}, ("servings", 2)),
    TableSpec("custom_activities", m.CustomActivity, lambda c: {"name": f"Rowing {c.token}", "met": 7}, ("met", 8.5)),
    TableSpec("exercise_entries", m.ExerciseEntry, lambda c: {"entry_date": DAY, "name": "Running", "duration_min": 30, "calories": 300}, ("calories", 320)),
    TableSpec("custom_exercises", m.CustomExercise, lambda c: {"name": f"Landmine press {c.token}"}, ("muscle", "shoulders")),
    TableSpec("routines", m.Routine, lambda c: {"name": f"Push day {c.token}"}, ("name", "Pull day")),
    TableSpec("routine_exercises", m.RoutineExercise, lambda c: {"routine_id": c.parents["routine"], "exercise_key": "bench_press", "exercise_name": "Bench Press", "target_sets": 3, "target_reps": 8}, ("target_reps", 10), {"routine": "routines"}),
    TableSpec("workouts", m.Workout, lambda c: {"workout_date": DAY, "name": f"Session {c.token}"}, ("completed", True)),
    TableSpec("workout_exercises", m.WorkoutExercise, lambda c: {"workout_id": c.parents["workout"], "exercise_key": "back_squat", "exercise_name": "Back Squat"}, ("notes", "Felt strong"), {"workout": "workouts"}),
    TableSpec("workout_sets", m.WorkoutSet, lambda c: {"workout_id": c.parents["workout"], "exercise_key": "back_squat", "exercise_name": "Back Squat", "reps": 5, "weight_lb": 225}, ("weight_lb", 235), {"workout": "workouts"}),
    TableSpec("measurements", m.Measurement, lambda c: {"measured_on": DAY, "value": 180.4}, ("value", 179.8)),
    TableSpec("exercise_notes", m.ExerciseNote, lambda c: {"exercise_key": f"custom:{c.token}", "notes": "Brace first"}, ("notes", "Elbows in")),
    TableSpec("meals", m.Meal, lambda c: {"name": f"Usual breakfast {c.token}"}, ("name", "Weekend breakfast")),
    TableSpec("meal_items", m.MealItem, lambda c: {"meal_id": c.parents["meal"], "food_name": "Greek yogurt", "nutrients": {"kcal": 100}}, ("servings", 1.5), {"meal": "meals"}),
    TableSpec("form_videos", m.FormVideo, lambda c: {"exercise_key": f"custom:{c.token}", "storage_path": f"clips/{c.token}.mp4", "duration_sec": 12}, ("duration_sec", 14)),
    TableSpec("strength_goals", m.StrengthGoal, lambda c: {"exercise_key": f"custom:{c.token}", "exercise_name": "Bench Press", "target_1rm_lb": 275, "target_weight_lb": 245, "target_reps": 3}, ("target_1rm_lb", 285)),
)
# fmt: on

TABLES_BY_NAME: dict[str, TableSpec] = {t.name: t for t in TABLES}
INSERTABLE: tuple[TableSpec, ...] = tuple(t for t in TABLES if not t.one_per_user)
