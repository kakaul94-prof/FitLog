"""Seeds a persona, plus a case's hostile text, into the local test stack.

Every write goes through PostgREST as the user under test, the same path the
app uses, so row-level security applies and every row belongs to that user.
Deleting the user at the end of the run removes it all.
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import httpx

from aievals.dataset import (
    CardioSpec,
    GoalSpec,
    Persona,
    SeedKind,
    SetSpec,
    WorkoutSpec,
)
from testkit.auth import SignedInUser
from testkit.rest import RestClient

Row = dict[str, Any]


@dataclass(frozen=True)
class PersonaUser:
    """A real signed-in user whose account holds a seeded persona."""

    user: SignedInUser
    api: RestClient  # PostgREST as this user
    persona: Persona


# make(persona="sam", seed={}) -> a fresh user seeded with that persona (a fixture).
MakePersonaUser = Callable[..., PersonaUser]


class SeedError(RuntimeError):
    """The local stack refused a row the persona needs."""


def with_seed(persona: Persona, seed: Mapping[SeedKind, str]) -> Persona:
    """The persona with each piece of hostile text planted where its kind says."""
    for kind, text in seed.items():
        persona = _PLANTERS[kind](persona, text)
    return persona


def seed_persona(api: RestClient, user_id: str, persona: Persona, today: date) -> None:
    """Write the whole persona for the user that `api` is signed in as."""
    PersonaWriter(api, user_id, today).write(persona)


# -- planting hostile text -------------------------------------------------------------


def _latest(persona: Persona) -> WorkoutSpec:
    return min(persona.workouts, key=lambda w: w.days_ago)


def _replace_latest(persona: Persona, workout: WorkoutSpec) -> Persona:
    latest = _latest(persona)
    workouts = [workout if w is latest else w for w in persona.workouts]
    return persona.model_copy(update={"workouts": workouts})


def _plant_workout_name(persona: Persona, text: str) -> Persona:
    # The snapshot names only the most recent session, so add a newer one.
    squat = SetSpec(key="back_squat", name="Back Squat", lb=225, reps=5, sets=3)
    newest = WorkoutSpec(days_ago=_latest(persona).days_ago - 1, name=text, sets=[squat])
    return persona.model_copy(update={"workouts": [*persona.workouts, newest]})


def _plant_custom_exercise(persona: Persona, text: str) -> Persona:
    latest = _latest(persona)
    lift = SetSpec(key=f"custom:{uuid.uuid4()}", name=text, lb=60, reps=10, sets=3)
    return _replace_latest(persona, latest.model_copy(update={"sets": [*latest.sets, lift]}))


def _plant_set_pain(persona: Persona, text: str) -> Persona:
    latest = _latest(persona)
    first, *rest = latest.sets
    sets = [first.model_copy(update={"pain": text}), *rest]
    return _replace_latest(persona, latest.model_copy(update={"sets": sets}))


def _plant_injury_note(persona: Persona, text: str) -> Persona:
    first, *rest = persona.injuries
    return persona.model_copy(update={"injuries": [first.model_copy(update={"note": text}), *rest]})


_PLANTERS: dict[SeedKind, Callable[[Persona, str], Persona]] = {
    "supplement": lambda p, t: p.model_copy(update={"supplements": [*p.supplements, t]}),
    "workout_name": _plant_workout_name,
    "custom_exercise": _plant_custom_exercise,
    "set_pain": _plant_set_pain,
    "injury_note": _plant_injury_note,
    "routine_name": lambda p, t: p.model_copy(update={"routines": [*p.routines, t]}),
    "cardio_name": lambda p, t: p.model_copy(
        update={"cardio": [*p.cardio, CardioSpec(days_ago=3, name=t, minutes=40)]}
    ),
    "goal_exercise": lambda p, t: p.model_copy(
        update={"goals": [*p.goals, GoalSpec(key=f"custom:{uuid.uuid4()}", name=t, lb=205, reps=5)]}
    ),
    "memory": lambda p, t: p.model_copy(update={"memory": [*p.memory, t]}),
}


# -- writing rows -------------------------------------------------------------------------


class PersonaWriter:
    def __init__(self, api: RestClient, user_id: str, today: date) -> None:
        self._api = api
        self._user_id = user_id
        self._today = today

    def write(self, persona: Persona) -> None:
        supplement_ids = [
            self._create("foods", {"name": n, "nutrients": {}})["id"] for n in persona.supplements
        ]
        routine_ids = [self._create("routines", {"name": n})["id"] for n in persona.routines]
        self._update_profile(persona, supplement_ids, routine_ids)
        self._insert(
            "measurements",
            [{"measured_on": self._day(w.days_ago), "value": w.lb} for w in persona.weights],
        )
        for workout in persona.workouts:
            self._write_workout(workout)
        self._write_diary(persona)
        self._insert(
            "exercise_entries",
            [
                {
                    "entry_date": self._day(c.days_ago),
                    "name": c.name,
                    "duration_min": c.minutes,
                    "calories": c.minutes * 6,
                }
                for c in persona.cardio
            ],
        )
        self._insert(
            "strength_goals",
            [
                {
                    "exercise_key": g.key,
                    "exercise_name": g.name,
                    "target_weight_lb": g.lb,
                    "target_reps": g.reps,
                    "target_1rm_lb": round(g.lb * (1 + g.reps / 30)),
                }
                for g in persona.goals
            ],
        )

    def _update_profile(
        self, persona: Persona, supplement_ids: list[str], routine_ids: list[str]
    ) -> None:
        p = persona.profile
        injury_ids = [str(uuid.uuid4()) for _ in persona.injuries]
        injuries = [
            {
                "id": injury_id,
                "site": i.site,
                "side": i.side,
                "note": i.note,
                "started": self._day(i.days_ago),
                "status": "active",
                "resolved": None,
                "aggravates": i.aggravates,
                "plan": [],
            }
            for injury_id, i in zip(injury_ids, persona.injuries, strict=True)
        ]
        checkins = [
            {
                "id": str(uuid.uuid4()),
                "injuryId": injury_id,
                "date": self._day(s.days_ago),
                "pain": s.score,
            }
            for injury_id, i in zip(injury_ids, persona.injuries, strict=True)
            for s in i.pain
        ]
        values: Row = {
            "sex": p.sex,
            "birth_date": date(self._today.year - p.age, 1, 1).isoformat(),
            "height_cm": p.height_cm,
            "activity_level": p.activity_level,
            "goal_type": "maintain",
            "goal_rate_lb_per_week": 0,
            "calorie_goal_mode": "manual",
            "manual_calorie_goal": p.calorie_goal,
            "macro_targets": {
                "protein": {"mode": "g", "value": p.protein_g},
                "fat": {"mode": "pct", "value": 25},
                "carb": {"mode": "remainder"},
            },
            "daily_supplements": [{"food_id": i, "servings": 1} for i in supplement_ids],
            "rehab": {"injuries": injuries, "log": [], "checkins": checkins},
            "program": {
                "sequence": [
                    {"id": str(uuid.uuid4()), "kind": "routine", "routineId": r}
                    for r in routine_ids
                ]
            },
            "trainer_memory": [
                {"id": str(uuid.uuid4()), "text": m, "created_at": f"{self._today}T08:00:00Z"}
                for m in persona.memory
            ],
        }
        self._check("profiles", self._api.update("profiles", values, {"id": self._user_id}), 200)

    def _write_workout(self, workout: WorkoutSpec) -> None:
        row = self._create(
            "workouts",
            {"workout_date": self._day(workout.days_ago), "name": workout.name, "completed": True},
        )
        self._insert(
            "workout_sets",
            [
                {
                    "workout_id": row["id"],
                    "exercise_key": s.key,
                    "exercise_name": s.name,
                    "reps": s.reps,
                    "weight_lb": s.lb,
                    "pain": s.pain,
                }
                for s in workout.sets
                for _ in range(s.sets)
            ],
        )

    def _write_diary(self, persona: Persona) -> None:
        d = persona.diary
        if d is None:
            return
        nutrients = {"kcal": d.kcal, "protein": d.protein, "carb": d.carb, "fat": d.fat}
        if d.iron is not None:
            nutrients["iron"] = d.iron
        self._insert(
            "diary_entries",
            [
                {
                    "entry_date": self._day(n),
                    "food_name": "Logged day",
                    "servings": 1,
                    "nutrients": nutrients,
                }
                for n in range(1, d.days + 1)
            ],
        )

    # -- helpers --

    def _day(self, days_ago: int) -> str:
        return (self._today - timedelta(days=days_ago)).isoformat()

    def _create(self, table: str, row: Row) -> Row:
        resp = self._api.insert(table, row)
        self._check(table, resp, 201)
        created: Row = resp.json()[0]
        return created

    def _insert(self, table: str, rows: list[Row]) -> None:
        if rows:
            self._check(table, self._api.insert(table, rows), 201)

    @staticmethod
    def _check(table: str, resp: httpx.Response, status: int) -> None:
        if resp.status_code != status:
            raise SeedError(f"seeding {table} failed: {resp.status_code} {resp.text[:300]}")
