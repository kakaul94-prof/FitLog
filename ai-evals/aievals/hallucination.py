"""The hallucination rate of the grounding cases, and the record of every hallucination.

A reply *hallucinates* when it states something false: a figure, date or food
it attributes to the user that their data doesn't back (the `grounded` check,
or the judge confirming a figure the checker couldn't place), a fact the judge
finds invented (no_fabrication), or a general fact outside its known range
(`within`, `wrong_fact`). Leaving something out is not a hallucination: a
missing figure fails `value`, and not admitting missing data fails
`says_missing`, but those are quality failures, counted in the gate, not here.

Reported per reply (did this answer state anything false?) and per claim (of
the figures the checker looked at, how many were unbacked), with a 95% Wilson
interval: with a few hundred replies the interval is wide, and it says so.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from aievals.checks import FALSE_STATEMENT_CHECKS
from aievals.factcheck import FactCheck
from aievals.judge import PROVENANCE_RUBRIC
from aievals.scoring import Run

HALLUCINATION_JUDGES = frozenset({"no_fabrication", PROVENANCE_RUBRIC})

# Share of grounding replies that must state nothing false. One in twenty is the
# most a coach whose whole value is "your own numbers" can get away with; with
# ~150 replies a run, the 95% interval around a measured 95% is about +/-3.5 points.
FREE_BAR = 0.95


@dataclass(frozen=True)
class Finding:
    """One reply that stated something false, with everything needed to reproduce it."""

    case: str
    kind: str
    rep: int
    question: str
    reply: str
    reasons: list[str]
    decided_by: str  # "code", "judge" or "both"


def reasons(run: Run) -> tuple[list[str], list[str]]:
    """(what code found false, what the judge found false) in one run."""
    code = [
        f"{r.check}: {r.detail}"
        for r in run.rules
        if r.check in FALSE_STATEMENT_CHECKS and not r.passed
    ]
    judge = [
        f"judge {j.rubric}: {j.reason}"
        for j in run.judges
        if j.rubric in HALLUCINATION_JUDGES and j.passed is False
    ]
    return code, judge


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


@dataclass(frozen=True)
class Summary:
    replies: int = 0
    findings: list[Finding] = field(default_factory=list)
    by_kind: dict[str, tuple[int, int]] = field(
        default_factory=dict
    )  # kind -> (hallucinated, replies)
    claims_checked: int = 0  # figures about the user, or that might be
    claims_backed: int = 0
    claims_unbacked_code: int = 0  # plainly about the user, unbacked: code decides
    claims_to_judge: int = 0  # unbacked, attribution unclear: sent to the judge
    claims_judge_false: int = 0  # ... and the judge said they were passed off as the user's
    foods_invented: int = 0
    dates_wrong: int = 0

    @property
    def hallucinated(self) -> int:
        return len(self.findings)

    @property
    def rate(self) -> float | None:
        return self.hallucinated / self.replies if self.replies else None

    @property
    def free_rate(self) -> float | None:
        return None if self.rate is None else 1 - self.rate

    @property
    def claim_rate(self) -> float | None:
        if not self.claims_checked:
            return None
        return (self.claims_unbacked_code + self.claims_judge_false) / self.claims_checked

    def record(self) -> dict[str, Any]:
        lo, hi = wilson(self.hallucinated, self.replies)
        return {
            "replies": self.replies,
            "hallucinated": self.hallucinated,
            "rate": self.rate,
            "rate_ci95": [lo, hi],
            "by_kind": {
                k: {"replies": n, "hallucinated": h, "rate": h / n if n else None}
                for k, (h, n) in sorted(self.by_kind.items())
            },
            "claims": {
                "checked": self.claims_checked,
                "backed": self.claims_backed,
                "unbacked_code": self.claims_unbacked_code,
                "sent_to_judge": self.claims_to_judge,
                "judge_false": self.claims_judge_false,
                "rate": self.claim_rate,
            },
            "foods_invented": self.foods_invented,
            "dates_wrong": self.dates_wrong,
            "decided_by": {
                who: sum(f.decided_by == who for f in self.findings)
                for who in ("code", "judge", "both")
            },
            "cases": sorted({f.case for f in self.findings}),
        }

    def markdown(self) -> str:
        if not self.replies:
            return ""
        lo, hi = wilson(self.hallucinated, self.replies)
        lines = [
            "",
            "## Grounding: hallucination rate",
            "",
            f"**{self.hallucinated} of {self.replies} replies ({100 * (self.rate or 0):.1f}%, "
            f"95% CI {100 * lo:.1f}-{100 * hi:.1f}%) stated something the user's data "
            "doesn't support.**",
            "",
            "| Kind | Replies | Hallucinated | Rate |",
            "|---|--:|--:|--:|",
        ]
        for kind, (h, n) in sorted(self.by_kind.items()):
            lines.append(f"| {kind} | {n} | {h} | {100 * h / n:.0f}% |")
        claim_rate = 100 * (self.claim_rate or 0)
        lines += [
            "",
            f"Figures checked: {self.claims_checked}; backed by the data: {self.claims_backed}; "
            f"unbacked and plainly about the user (code): {self.claims_unbacked_code}; "
            f"unclear, sent to the judge: {self.claims_to_judge}, of which it found "
            f"{self.claims_judge_false} passed off as the user's. "
            f"Claim-level rate {claim_rate:.1f}%. "
            f"Invented foods: {self.foods_invented}; wrong dates: {self.dates_wrong}.",
            "",
        ]
        for f in self.findings:
            lines.append(f"- `{f.case}` run {f.rep} ({f.decided_by}): {'; '.join(f.reasons)[:300]}")
        return "\n".join(lines) + "\n"


def summarise(runs: Sequence[Run], checks: Mapping[tuple[str, int], FactCheck]) -> Summary:
    findings: list[Finding] = []
    by_kind: dict[str, list[int]] = {}
    checked = backed = unbacked = to_judge = judge_false = foods = dates = 0
    for run in runs:
        code, judged = reasons(run)
        tally = by_kind.setdefault(run.case.kind, [0, 0])
        tally[1] += 1
        if code or judged:
            tally[0] += 1
            findings.append(
                Finding(
                    run.case.id,
                    run.case.kind,
                    run.rep,
                    run.case.ask,
                    run.reply.raw,
                    code + judged,
                    "both" if code and judged else "code" if code else "judge",
                )
            )
        found = checks.get((run.case.id, run.rep))
        if found is None:
            continue
        mine = found.checked
        checked += len(mine)
        backed += sum(c.backed for c in mine)
        unbacked += len(found.unsupported)
        to_judge += len(found.unclear)
        if any(j.rubric == PROVENANCE_RUBRIC and j.passed is False for j in run.judges):
            judge_false += len(found.unclear)
        foods += len(found.foods)
        dates += len(found.dates)
    return Summary(
        len(runs),
        findings,
        {k: (h, n) for k, (h, n) in by_kind.items()},
        checked,
        backed,
        unbacked,
        to_judge,
        judge_false,
        foods,
        dates,
    )
