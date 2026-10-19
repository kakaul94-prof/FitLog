"""Incorrect outputs, the deterministic part: does Claude get the facts to be right?

A correct answer needs the user's real numbers in the prompt. The function cuts
the snapshot at 12,000 characters and the nutrition section is rendered last, so
an over-long snapshot would silently drop exactly the data that explains a stall.
Whether Claude *uses* the numbers correctly is the live tier's job.
"""

import pytest

from aievals.dataset import (
    CardioSpec,
    Dataset,
    DiarySpec,
    GoalSpec,
    InjurySpec,
    Persona,
    SetSpec,
    WorkoutSpec,
)
from aievals.harness import ClientHarness, TrainerInput
from aievals.personas import MakePersonaUser
from testkit.anthropic_stub import AnthropicStub
from testkit.functions import FunctionsClient
from testkit.models import ClaudeRequest

pytestmark = pytest.mark.functions

MAX_CONTEXT_CHARS = 12_000  # functions/api/trainer.ts


def system_prompt(claude: AnthropicStub) -> str:
    return ClaudeRequest.model_validate(claude.only_call().body).system or ""


def heavy_logger(base: Persona) -> Persona:
    """Every capped section of the snapshot filled to its cap, with long names."""
    lifts = [
        (f"custom:heavy-{i}", f"Paused tempo variation {i} with a long descriptive name")
        for i in range(10)
    ]
    workouts = [
        WorkoutSpec(
            days_ago=2 + 3 * w,
            name=f"Session {w}: full body with accessories and a conditioning finisher",
            sets=[
                SetSpec(
                    key=key,
                    name=name,
                    lb=100 + 5 * i,
                    reps=8,
                    sets=4,
                    pain=f"left knee ache, sharp on the way down, session {w}" if i == 0 else None,
                )
                for i, (key, name) in enumerate(lifts)
            ],
        )
        for w in range(12)
    ]
    note = "Started after a long run downhill; aches on stairs, worse in the morning. " * 2
    injuries = [
        InjurySpec(site=s, side="left", note=note[:190], days_ago=30, aggravates=["back_squat"])
        for s in ("knee", "shoulder", "low back")
    ]
    return base.model_copy(
        update={
            "workouts": workouts,
            "injuries": injuries,
            "diary": DiarySpec(days=28, kcal=2300, protein=140, carb=250, fat=80, iron=9),
            "supplements": [
                f"Brand {i} premium multivitamin with extended-release minerals" for i in range(12)
            ],
            "cardio": [
                CardioSpec(days_ago=1 + i, name=f"Intervals type {i}", minutes=45) for i in range(5)
            ],
            "goals": [GoalSpec(key=k, name=n, lb=200, reps=5) for k, n in lifts[:8]],
            "routines": [f"Routine {i}: upper-lower hybrid with long name" for i in range(7)],
        }
    )


def test_sams_snapshot_reaches_claude_in_full(
    trainer: FunctionsClient, claude: AnthropicStub, sam_input: TrainerInput
) -> None:
    trainer.ask_trainer("q", context=sam_input.context, memory=sam_input.memory)

    system = system_prompt(claude)
    missing = [line for line in sam_input.context.splitlines() if line.strip() not in system]
    assert missing == []


def test_a_heavy_loggers_snapshot_is_never_cut_short(
    functions: FunctionsClient,
    claude: AnthropicStub,
    harness: ClientHarness,
    make_persona_user: MakePersonaUser,
    dataset: Dataset,
) -> None:
    heavy = make_persona_user(heavy_logger(dataset.personas["sam"]))
    given = harness.trainer_input(heavy.user)

    assert len(given.context) <= MAX_CONTEXT_CHARS, f"snapshot is {len(given.context)} chars"
    functions.as_user(heavy.user.access_token).ask_trainer(
        "Why have I stalled?", context=given.context, memory=given.memory
    )
    last_line = given.context.rstrip().splitlines()[-1]
    assert last_line in system_prompt(claude), "the end of the snapshot (nutrition) was dropped"


def test_a_full_memory_list_reaches_claude(trainer: FunctionsClient, claude: AnthropicStub) -> None:
    """The app saves at most 40 facts of 200 characters; all of them must arrive."""
    memory = [f"Fact {i:02}: " + "x" * 190 for i in range(40)]

    trainer.ask_trainer("q", memory=memory)

    system = system_prompt(claude)
    assert [m for m in memory if m not in system] == []
