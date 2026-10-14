"""Turns scored runs into per-case outcomes and per-category gates.

A *run* is one (case, repetition) that produced a reply. Infrastructure failures
(Claude unreachable after retries, the call budget spent, a judge that couldn't
answer) never become runs: they are reported separately, so a broken pipeline
can't look like a well-behaved model, or a badly-behaved one.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal

from aievals.checks import CheckResult
from aievals.dataset import CATEGORIES, Case, Category
from aievals.harness import ParsedReply
from aievals.pricing import Usage
from aievals.thresholds import BARS, KIND_BARS

CaseStatus = Literal["pass", "inconsistent", "fail", "unscored"]


@dataclass(frozen=True)
class JudgeResult:
    rubric: str
    passed: bool | None  # None: the judge failed to give a verdict (an infra error)
    reason: str
    usage: Usage = field(default_factory=Usage)


@dataclass(frozen=True)
class Run:
    case: Case
    rep: int
    reply: ParsedReply
    rules: list[CheckResult]
    judges: list[JudgeResult]
    ms: int = 0  # how long the trainer took to answer, 0 when it wasn't timed

    @property
    def rule_passed(self) -> bool | None:
        return all(r.passed for r in self.rules) if self.rules else None

    @property
    def judge_passed(self) -> bool | None:
        if not self.judges or any(j.passed is None for j in self.judges):
            return None
        return all(j.passed for j in self.judges)

    @property
    def passed(self) -> bool:
        return self.rule_passed is not False and self.judge_passed is not False


@dataclass(frozen=True)
class CaseOutcome:
    case: Case
    passes: int
    runs: int
    status: CaseStatus


@dataclass(frozen=True)
class Metric:
    name: str  # "rules", "judged" or a kind with its own bar
    rate: float | None  # None when no run had this kind of check
    bar: float
    runs: int

    @property
    def met(self) -> bool:
        return self.rate is None or self.rate >= self.bar


@dataclass(frozen=True)
class CategoryGate:
    category: Category
    metrics: list[Metric]

    @property
    def met(self) -> bool:
        return all(m.met for m in self.metrics)


def case_outcomes(cases: Sequence[Case], runs: Iterable[Run]) -> list[CaseOutcome]:
    by_case: dict[str, list[Run]] = {c.id: [] for c in cases}
    for run in runs:
        by_case[run.case.id].append(run)
    out = []
    for case in cases:
        mine = by_case[case.id]
        passes = sum(r.passed for r in mine)
        status: CaseStatus = (
            "unscored"
            if not mine
            else "pass"
            if passes == len(mine)
            else "fail"
            if passes == 0
            else "inconsistent"
        )
        out.append(CaseOutcome(case, passes, len(mine), status))
    return out


def _rate(values: list[bool]) -> float | None:
    return sum(values) / len(values) if values else None


def category_gates(runs: Sequence[Run]) -> list[CategoryGate]:
    gates = []
    for category in CATEGORIES:
        mine = [r for r in runs if r.case.category == category]
        special = {kind: bar for (cat, kind), (bar, _) in KIND_BARS.items() if cat == category}
        general = [r for r in mine if r.case.kind not in special]
        rules = [p for r in general if (p := r.rule_passed) is not None]
        judged = [p for r in mine if (p := r.judge_passed) is not None]
        metrics = [
            Metric("rules", _rate(rules), BARS[category].rule, len(rules)),
            Metric("judged", _rate(judged), BARS[category].judge, len(judged)),
        ]
        for kind, bar in special.items():
            kind_rules = [
                p for r in mine if r.case.kind == kind and (p := r.rule_passed) is not None
            ]
            metrics.append(Metric(kind, _rate(kind_rules), bar, len(kind_rules)))
        gates.append(CategoryGate(category, metrics))
    return gates
