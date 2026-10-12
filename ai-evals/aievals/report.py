"""A live run's results: the summary record, its Markdown, and the run history.

The summary is what the history keeps (one record per run, newest last) and
what the quality dashboard charts: model, date, pass rates by category,
inconsistent and failing cases, errors and the cost.

    python -m aievals.report publish <history.json> <summary.json>   # append, keep 100
"""

import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aievals.scoring import CaseOutcome, CategoryGate

HISTORY_LIMIT = 100


@dataclass(frozen=True)
class Cost:
    trainer_model: str
    trainer_usd: float
    trainer_calls: int
    judge_model: str
    judge_usd: float
    judge_calls: int

    @property
    def total_usd(self) -> float:
        return self.trainer_usd + self.judge_usd


def build_summary(
    *,
    run_id: str,
    timestamp: str,
    git_sha: str,
    reps: int,
    dry_run: bool,
    outcomes: Sequence[CaseOutcome],
    gates: Sequence[CategoryGate],
    errors: int,
    served_models: Sequence[str],
    cost: Cost,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "timestamp": timestamp,
        "git_sha": git_sha,
        "dry_run": dry_run,
        "model": cost.trainer_model,
        "served_models": sorted(set(served_models)),
        "judge_model": cost.judge_model,
        "reps": reps,
        "cases": len(outcomes),
        # "incomplete": some attempts never produced a reply to score, so the run
        # can't claim a pass or a fail; each category still shows what it saw.
        "gate": "incomplete" if errors else "pass" if all(g.met for g in gates) else "fail",
        "categories": {
            g.category: {
                "met": g.met,
                "metrics": {
                    m.name: {"rate": m.rate, "bar": m.bar, "runs": m.runs, "met": m.met}
                    for m in g.metrics
                },
            }
            for g in gates
        },
        "failing": [o.case.id for o in outcomes if o.status == "fail"],
        "inconsistent": [o.case.id for o in outcomes if o.status == "inconsistent"],
        "unscored": [o.case.id for o in outcomes if o.status == "unscored"],
        "errors": errors,
        "cost": {
            "trainer_usd": round(cost.trainer_usd, 4),
            "judge_usd": round(cost.judge_usd, 4),
            "total_usd": round(cost.total_usd, 4),
            "trainer_calls": cost.trainer_calls,
            "judge_calls": cost.judge_calls,
        },
    }


def _pct(rate: float | None) -> str:
    return "n/a" if rate is None else f"{rate:.0%}"


def render_markdown(summary: dict[str, Any], outcomes: Sequence[CaseOutcome]) -> str:
    lines = [
        f"## AI trainer evals, live tier: {summary['gate'].upper()}"
        + (" (dry run: the stub, not Claude)" if summary["dry_run"] else ""),
        "",
        f"Model `{summary['model']}`, judge `{summary['judge_model']}`, "
        f"{summary['cases']} cases x {summary['reps']} runs, {summary['timestamp']}.",
        "",
        "| Category | Rule checks | Judged checks | Other | Gate |",
        "|---|---|---|---|---|",
    ]
    for category, data in summary["categories"].items():
        metrics = data["metrics"]
        other = ", ".join(
            f"{name} {_pct(m['rate'])} (bar {m['bar']:.0%})"
            for name, m in metrics.items()
            if name not in ("rules", "judged")
        )
        cell = {
            k: f"{_pct(m['rate'])} of {m['runs']} (bar {m['bar']:.0%})"
            for k, m in metrics.items()
            if k in ("rules", "judged")
        }
        lines.append(
            f"| {category} | {cell['rules']} | {cell['judged']} | {other or '-'} | "
            f"{'met' if data['met'] else '**NOT MET**'} |"
        )
    flagged = [o for o in outcomes if o.status != "pass"]
    if flagged:
        lines += ["", "| Case | Status | Passed runs |", "|---|---|---|"]
        lines += [f"| `{o.case.id}` | {o.status} | {o.passes}/{o.runs} |" for o in flagged]
    cost = summary["cost"]
    lines += [
        "",
        f"Errors (not scored): {summary['errors']}. Cost: ${cost['total_usd']:.2f} "
        f"(trainer ${cost['trainer_usd']:.2f} for {cost['trainer_calls']} calls, "
        f"judge ${cost['judge_usd']:.2f} for {cost['judge_calls']} calls).",
    ]
    return "\n".join(lines) + "\n"


def append_history(path: Path, summary: dict[str, Any]) -> None:
    """Add a run to the history file (created if missing), keeping the newest 100."""
    history = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    history = [*history, summary][-HISTORY_LIMIT:]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(history, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "publish":
        sys.exit("usage: python -m aievals.report publish <history.json> <summary.json>")
    run = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
    if run["dry_run"]:
        sys.exit("refusing to publish a dry run: its numbers come from the stub, not Claude")
    append_history(Path(sys.argv[2]), run)
