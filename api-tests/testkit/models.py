"""Response contracts: one pydantic model per table, written from supabase/schema.sql.

The models are strict on purpose:
- `extra="forbid"`: a column added without updating its contract fails the
  contract tests, so schema changes are always a deliberate, reviewed step.
- `strict=True`: no silent coercion (a "5" where an integer belongs is a failure).
- `Literal` types mirror the CHECK constraints, so an out-of-range value coming
  back from the API is caught too.
"""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter

Json = Any  # free-form jsonb columns the database doesn't constrain


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class Owned(Contract):
    id: UUID
    user_id: UUID
    created_at: datetime


class Profile(Contract):
    id: UUID
    sex: Literal["male", "female"] | None
    birth_date: date | None
    height_cm: float | None
    activity_level: Literal["sedentary", "light", "moderate", "active", "very_active"]
    weight_unit: str
    distance_unit: str
    goal_type: Literal["lose", "maintain", "gain"]
    goal_rate_lb_per_week: float
    goal_weight_lb: float | None
    calorie_goal_mode: Literal["calculated", "manual"]
    manual_calorie_goal: int | None
    calorie_goal_history: list[Json]
    macro_targets: dict[str, Json]
    eat_back_exercise: bool
    volume_targets: dict[str, Json] | None
    daily_supplements: list[Json]
    max_hr: int | None
    resting_hr: int | None
    program: Json | None
    weekly_cardio_min_target: int | None
    cardio_goal: Json | None
    step_goal: int | None
    coach_enabled: bool
    trainer_memory: list[Json]
    fuel_timing: Json | None
    rehab: dict[str, Json]
    created_at: datetime
    updated_at: datetime


class Food(Owned):
    name: str
    brand: str | None
    source: Literal["usda", "manual", "recipe"]
    source_id: str | None
    serving_qty: float
    serving_unit: str
    serving_grams: float | None
    recipe_servings: float | None
    nutrients: dict[str, float]
    portions: list[dict[str, Json]]
    archived: bool
    updated_at: datetime


class RecipeIngredient(Owned):
    recipe_food_id: UUID
    ingredient_food_id: UUID
    amount: float | None
    unit: str | None
    servings: float
    position: int


class DiaryEntry(Owned):
    entry_date: date
    meal: Literal["breakfast", "lunch", "dinner", "snacks"]
    food_id: UUID | None
    food_name: str
    brand: str | None
    servings: float
    serving_qty: float | None
    serving_unit: str | None
    nutrients: dict[str, float]
    position: int


class CustomActivity(Owned):
    name: str
    met: float
    distance_based: bool


class ExerciseEntry(Owned):
    entry_date: date
    name: str
    met: float | None
    duration_min: float | None
    distance_mi: float | None
    calories: int
    avg_hr: int | None
    zone: Literal[1, 2, 3, 4, 5] | None
    load_lb: float | None
    level: int | None
    level_max: int | None
    max_hr: int | None
    hr_samples: Json | None
    zone_seconds: list[int] | None


class CustomExercise(Owned):
    name: str
    muscle: str | None
    equipment: str | None
    type: Literal["weighted", "bodyweight", "timed", "cardio"]


class Routine(Owned):
    name: str
    position: int
    updated_at: datetime


class RoutineExercise(Contract):
    # No created_at on this table.
    id: UUID
    user_id: UUID
    routine_id: UUID
    exercise_key: str
    exercise_name: str
    position: int
    target_sets: int | None
    target_reps: int | None
    is_optional: bool
    superset_group: int | None
    target_duration_min: float | None
    target_distance_mi: float | None
    target_zone: Literal[1, 2, 3, 4, 5] | None
    intervals: Json | None


class Workout(Owned):
    workout_date: date
    name: str | None
    source_routine_id: UUID | None
    notes: str | None
    rest_seconds: int
    completed: bool


class WorkoutExercise(Owned):
    workout_id: UUID
    exercise_key: str
    exercise_name: str
    position: int
    notes: str | None
    superset_group: int | None
    started_at: datetime | None
    ended_at: datetime | None


class WorkoutSet(Owned):
    workout_id: UUID
    workout_exercise_id: UUID | None
    exercise_key: str
    exercise_name: str
    set_number: int
    reps: float | None
    weight_lb: float | None
    duration_sec: float | None
    distance: float | None
    effort: int | None
    is_warmup: bool
    started_at: datetime | None
    ended_at: datetime | None
    feel: Literal["good", "off"] | None
    pain: str | None


class Measurement(Owned):
    measured_on: date
    type: str
    value: float
    unit: str
    source: str | None


class ExerciseNote(Owned):
    exercise_key: str
    notes: str | None
    hidden_cues: list[str]
    starred_cues: list[str]
    updated_at: datetime


class Meal(Owned):
    name: str
    position: int
    updated_at: datetime


class MealItem(Owned):
    meal_id: UUID
    food_id: UUID | None
    food_name: str
    brand: str | None
    servings: float
    serving_qty: float | None
    serving_unit: str | None
    nutrients: dict[str, float]
    position: int


class FormVideo(Owned):
    exercise_key: str
    storage_path: str
    duration_sec: int | None
    size_bytes: int | None


class StrengthGoal(Owned):
    exercise_key: str
    exercise_name: str
    target_1rm_lb: float
    target_weight_lb: float
    target_reps: int
    method: Literal["linear", "double", "531"]
    increment_lb: float | None
    rep_low: int
    rep_high: int
    sets: int
    tm_lb: float | None
    cycle: int
    week: int
    achieved_at: datetime | None
    target_date: date | None
    updated_at: datetime


class PostgrestError(Contract):
    """The error body PostgREST returns for a rejected request."""

    code: str
    message: str
    details: str | None
    hint: str | None


def parse_rows[M: BaseModel](model: type[M], resp: httpx.Response) -> list[M]:
    """Validate a PostgREST array response against a contract (JSON mode, strict)."""
    return TypeAdapter(list[model]).validate_json(resp.content)  # type: ignore[valid-type]


def parse_error(resp: httpx.Response) -> PostgrestError:
    return PostgrestError.model_validate_json(resp.content)
