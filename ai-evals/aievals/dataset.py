"""The eval dataset: synthetic personas and the cases run against them.

Loaded from ai-evals/dataset/*.yaml into strict models, so a typo in a case
file (an unknown check, a misspelt seed kind) fails loading instead of quietly
testing nothing.
"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "dataset"
RUBRICS_DIR = ROOT / "rubrics"

Category = Literal[
    "prompt_injection", "information_exposure", "unintended_actions", "output_quality"
]
CATEGORIES: tuple[Category, ...] = (
    "prompt_injection",
    "information_exposure",
    "unintended_actions",
    "output_quality",
)

# Where a case's hostile text is planted. Each one is user-controlled text that
# src/lib/trainerContext.ts (or the memory list) puts in front of the model.
SeedKind = Literal[
    "supplement",  # a daily-supplement food name (can come from Open Food Facts)
    "workout_name",  # the name of the most recent workout
    "custom_exercise",  # a custom exercise's name, on a logged set
    "set_pain",  # the free-text pain note on a logged set
    "injury_note",  # the note on an open rehab injury
    "routine_name",  # a routine in the program rotation
    "cardio_name",  # a cardio activity's name
    "goal_exercise",  # the exercise name on a strength goal
    "memory",  # a saved trainer-memory fact
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# -- personas --------------------------------------------------------------------------


class ProfileSpec(Strict):
    sex: Literal["male", "female"]
    age: int
    height_cm: float
    activity_level: Literal["sedentary", "light", "moderate", "active", "very_active"]
    calorie_goal: int
    protein_g: int


class WeighIn(Strict):
    days_ago: int
    lb: float


class SetSpec(Strict):
    key: str
    name: str
    lb: float
    reps: int
    sets: int = 1
    pain: str | None = None


class WorkoutSpec(Strict):
    days_ago: int
    name: str
    sets: list[SetSpec]


class DiarySpec(Strict):
    """One identical entry a day, so the averages in the snapshot are exact."""

    days: int
    kcal: float
    protein: float
    carb: float
    fat: float
    iron: float | None = None


class PainScore(Strict):
    days_ago: int
    score: int


class InjurySpec(Strict):
    site: str
    side: Literal["left", "right", "both"] | None
    note: str
    days_ago: int
    aggravates: list[str] = Field(default_factory=list)
    pain: list[PainScore] = Field(default_factory=list)


class CardioSpec(Strict):
    days_ago: int
    name: str
    minutes: int


class GoalSpec(Strict):
    key: str
    name: str
    lb: float
    reps: int


class Persona(Strict):
    about: str = ""
    canaries: list[str] = Field(default_factory=list)  # strings that must never leak
    profile: ProfileSpec
    weights: list[WeighIn] = Field(default_factory=list)
    workouts: list[WorkoutSpec] = Field(default_factory=list)
    diary: DiarySpec | None = None
    supplements: list[str] = Field(default_factory=list)
    injuries: list[InjurySpec] = Field(default_factory=list)
    cardio: list[CardioSpec] = Field(default_factory=list)
    goals: list[GoalSpec] = Field(default_factory=list)
    routines: list[str] = Field(default_factory=list)
    memory: list[str] = Field(default_factory=list)


# -- cases -----------------------------------------------------------------------------


class Turn(Strict):
    role: Literal["user", "assistant"]
    content: str


class Expect(Strict):
    """Rule-based checks on one reply. Every listed check must pass."""

    contains_any: list[str] = Field(default_factory=list)
    not_contains: list[str] = Field(default_factory=list)
    not_matches: list[str] = Field(default_factory=list)  # regexes, case-insensitive
    numbers_include: list[float] = Field(default_factory=list)
    no_prompt_leak: bool = False  # no 8-word run copied from the static rules
    no_secrets: bool = False  # no keys, tokens or other secret shapes
    remember: Literal["none"] | None = None  # no "Remember" chip at all
    remember_not_containing: list[str] = Field(default_factory=list)
    remember_containing_any: list[str] = Field(default_factory=list)

    def is_empty(self) -> bool:
        return self == Expect()


class Case(Strict):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    category: Category
    kind: str
    title: str
    persona: str = "sam"
    seed: dict[SeedKind, str] = Field(default_factory=dict)
    history: list[Turn] = Field(default_factory=list)
    ask: str
    expect: Expect = Field(default_factory=Expect)
    judge: list[str] = Field(default_factory=list)  # rubric ids (rubrics/<id>.md)
    note: str | None = None

    @model_validator(mode="after")
    def _has_a_check(self) -> "Case":
        if self.expect.is_empty() and not self.judge:
            raise ValueError(f"case {self.id} checks nothing: add `expect` or `judge`")
        return self


class Dataset(Strict):
    personas: dict[str, Persona]
    cases: list[Case]

    def by_category(self, category: Category) -> list[Case]:
        return [c for c in self.cases if c.category == category]

    def seeded(self) -> list[Case]:
        """Cases that plant hostile text in the user's data or memory."""
        return [c for c in self.cases if c.seed]


def load_dataset(directory: Path = DATASET_DIR) -> Dataset:
    personas = yaml.safe_load((directory / "personas.yaml").read_text(encoding="utf-8"))
    cases: list[Case] = []
    for path in sorted(directory.glob("*.yaml")):
        if path.name == "personas.yaml":
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        cases += [Case(category=doc["category"], **raw) for raw in doc["cases"]]
    return Dataset(personas=personas, cases=cases)


def rubric_ids() -> set[str]:
    return {p.stem for p in RUBRICS_DIR.glob("*.md")}
