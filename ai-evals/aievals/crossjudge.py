"""Compares the promptfoo layer with the custom suite, on the same replies.

    python -m aievals.crossjudge <promptfoo run dir> [--calibration <dir>] [--yes]
    (npm run eval:pf:compare -- <run dir> --calibration <dir> --yes)

Writes <run dir>/comparison.md and comparison.json:

1. Judges on the golden replies. Every llm-rubric verdict promptfoo gave in the
   run, beside the custom judge's (aievals/judge.py) on the same reply, under
   the same rubric, shown the same text (the bubble plus any chip) and the same
   log. Agreement, Cohen's kappa, per rubric and per model, and every
   disagreement with both reasons. Nobody has labelled these replies.
2. Judges against the hand labels. The 15 calibration replies
   (calibration/labels.yaml), graded twice by promptfoo (a calibration run) and
   twice by the custom judge here: agreement with the labels, kappa,
   self-consistency, and for each reply which grader matched the label.
3. Rule checks. aievals/checks.py on every promptfoo reply, beside promptfoo's
   rule assertions (the built-ins and the JavaScript port): any check the two
   score differently is listed. Fairness groups are scored too (parity and same
   targets, aievals/equivalence.py), which promptfoo has no notion of.

The custom judge's verdicts are cached beside the results (custom_judge.jsonl),
so a re-run spends only on what is missing. Nothing is spent without --yes.
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anthropic
import yaml

from aievals.calibrate import LABELS, RESPONSES, Item, cohens_kappa
from aievals.checks import CheckResult, run_rules
from aievals.dataset import Case, load_dataset
from aievals.equivalence import groups, score_group
from aievals.harness import ParsedReply, TrainerInput
from aievals.judge import JUDGE_MODEL, Judge, judge_prompt
from aievals.live import judge_log, load_key, shown_to_judge
from aievals.pricing import Usage, cost_usd
from aievals.prompt import static_rules
from aievals.scoring import JudgeResult, Run

JUDGE_MAX_TOKENS = 1024  # aievals/judge.py
EXPECTED_USAGE = Usage(950, 86)  # the custom judge's average in the last full live run
CHARS_PER_TOKEN = 3


@dataclass(frozen=True)
class Reply:
    """One promptfoo result that produced a reply."""

    label: str  # the provider (model) label
    case: Case
    rep: int  # 1-based, per (label, case)
    parsed: ParsedReply
    given: TrainerInput
    system: str
    components: list[dict[str, Any]]

    @property
    def key(self) -> str:
        return f"{self.label}|{self.case.id}|{self.rep}"


@dataclass(frozen=True)
class Verdict:
    passed: bool | None
    reason: str


def _results(run_dir: Path) -> list[dict[str, Any]]:
    doc = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    inner = doc.get("results", doc)
    rows: list[dict[str, Any]] = inner.get("results", []) if isinstance(inner, dict) else inner
    return rows


def _errored(row: dict[str, Any]) -> bool:
    """A result with no reply to score. promptfoo also puts an assertion's failure
    text in `error`; failureReason 2 marks a real error."""
    return row.get("failureReason") == 2 or bool((row.get("response") or {}).get("error"))


def _metric(component: dict[str, Any]) -> str:
    return str((component.get("assertion") or {}).get("metric") or "")


def load_replies(run_dir: Path, cases: dict[str, Case]) -> tuple[list[Reply], int]:
    """The run's replies, and how many results were errors (never scored)."""
    replies: list[Reply] = []
    seen: Counter[tuple[str, str]] = Counter()
    errors = 0
    for row in _results(run_dir):
        if _errored(row):
            errors += 1
            continue
        label = str((row.get("provider") or {}).get("label") or "")
        case = cases[row["vars"]["case_id"]]
        seen[(label, case.id)] += 1
        meta = row["response"]["metadata"]
        raw = str(row["response"]["output"])
        replies.append(
            Reply(
                label=label,
                case=case,
                rep=seen[(label, case.id)],
                parsed=ParsedReply(raw=raw, text=meta["shown"], remember=meta["remember"]),
                given=TrainerInput(context=meta["context"], memory=list(meta["memory"])),
                system=str(meta.get("system") or ""),
                components=list((row.get("gradingResult") or {}).get("componentResults") or []),
            )
        )
    return replies, errors


# -- the custom judge, cached --------------------------------------------------------------


class CachedJudge:
    """The custom judge, with every verdict kept in a JSONL file beside the results."""

    def __init__(self, path: Path, judge: Judge | None) -> None:
        self._path = path
        self._judge = judge
        self.cache: dict[str, dict[str, Any]] = {}
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                self.cache[row["key"]] = row
        self.spent = Usage()

    def missing(self, keys: Sequence[str]) -> list[str]:
        return [k for k in keys if k not in self.cache]

    def grade_all(self, jobs: Sequence[tuple[str, str, str, str, str]]) -> None:
        """jobs: (cache key, rubric, question, reply, log); only uncached ones are judged."""
        todo = [j for j in jobs if j[0] not in self.cache]
        if not todo:
            return
        if self._judge is None:
            raise RuntimeError("the custom judge has no key")
        judge = self._judge

        def one(job: tuple[str, str, str, str, str]) -> dict[str, Any]:
            key, rubric, question, reply, log = job
            result = judge.grade(rubric, question, reply, log)
            return {
                "key": key,
                "rubric": rubric,
                "passed": result.passed,
                "reason": result.reason,
                "input_tokens": result.usage.input_tokens,
                "output_tokens": result.usage.output_tokens,
            }

        with ThreadPoolExecutor(4) as pool, self._path.open("a", encoding="utf-8") as out:
            for row in pool.map(one, todo):
                self.cache[row["key"]] = row
                self.spent += Usage(row["input_tokens"], row["output_tokens"])
                out.write(json.dumps(row, ensure_ascii=False) + "\n")

    def verdict(self, key: str) -> Verdict:
        row = self.cache[key]
        return Verdict(row["passed"], row["reason"])

    def total_usage(self, keys: Sequence[str]) -> Usage:
        return sum(
            (Usage(self.cache[k]["input_tokens"], self.cache[k]["output_tokens"]) for k in keys),
            Usage(),
        )


def judge_jobs(replies: Sequence[Reply]) -> list[tuple[str, str, str, str, str]]:
    return [
        (
            f"{r.key}|{rubric}",
            rubric,
            r.case.ask,
            shown_to_judge(r.parsed),
            judge_log(r.given),
        )
        for r in replies
        for rubric in r.case.judge
        if any(_metric(c) == f"judge:{rubric}" for c in r.components)
    ]


def worst_case_usd(jobs: Sequence[tuple[str, str, str, str, str]]) -> float:
    total = 0.0
    for _, rubric, question, reply, log in jobs:
        chars = len(judge_prompt(rubric, question, reply, log)) + 1_000  # + the judge's rules
        total += cost_usd(JUDGE_MODEL, Usage(chars // CHARS_PER_TOKEN, JUDGE_MAX_TOKENS))
    return total


# -- statistics ---------------------------------------------------------------------------


def agreement(pairs: Sequence[tuple[bool, bool]]) -> dict[str, Any]:
    if not pairs:
        return {"n": 0, "agree": 0, "rate": None, "kappa": None}
    agree = sum(a == b for a, b in pairs)
    first, second = [a for a, _ in pairs], [b for _, b in pairs]
    return {
        "n": len(pairs),
        "agree": agree,
        "rate": agree / len(pairs),
        "kappa": cohens_kappa(first, second),
        "first_pass_rate": sum(first) / len(first),
        "second_pass_rate": sum(second) / len(second),
        "confusion": {
            "both_pass": sum(a and b for a, b in pairs),
            "both_fail": sum(not a and not b for a, b in pairs),
            "first_only": sum(a and not b for a, b in pairs),
            "second_only": sum(b and not a for a, b in pairs),
        },
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.0%}"


def promptfoo_verdict(reply: Reply, rubric: str) -> Verdict:
    for c in reply.components:
        if _metric(c) == f"judge:{rubric}":
            reason = str(c.get("reason") or "")
            # A grader that gave no verdict is not a fail (the custom suite's rule).
            no_verdict = not c.get("pass") and reason.lower().startswith(
                ("error", "could not", "failed to", "llm-rubric produced")
            )
            return Verdict(None if no_verdict else bool(c.get("pass")), reason)
    return Verdict(None, "no llm-rubric result")


# -- 1. judges on the golden replies ---------------------------------------------------------


def golden_comparison(replies: Sequence[Reply], judge: CachedJudge) -> dict[str, Any]:
    rows = []
    for r in replies:
        for rubric in r.case.judge:
            key = f"{r.key}|{rubric}"
            if key not in judge.cache:
                continue
            pf, custom = promptfoo_verdict(r, rubric), judge.verdict(key)
            rows.append(
                {
                    "model": r.label,
                    "case": r.case.id,
                    "category": r.case.category,
                    "rep": r.rep,
                    "rubric": rubric,
                    "promptfoo": pf.passed,
                    "promptfoo_reason": pf.reason,
                    "custom": custom.passed,
                    "custom_reason": custom.reason,
                    "reply": shown_to_judge(r.parsed),
                }
            )
    scored = [x for x in rows if x["promptfoo"] is not None and x["custom"] is not None]

    def stats(subset: Sequence[dict[str, Any]]) -> dict[str, Any]:
        # first = the custom judge, second = promptfoo
        return agreement([(bool(x["custom"]), bool(x["promptfoo"])) for x in subset])

    by_rubric = defaultdict(list)
    by_model = defaultdict(list)
    for x in scored:
        by_rubric[x["rubric"]].append(x)
        by_model[x["model"]].append(x)
    return {
        "verdicts": len(rows),
        "no_verdict": {
            "promptfoo": sum(x["promptfoo"] is None for x in rows),
            "custom": sum(x["custom"] is None for x in rows),
        },
        "overall": stats(scored),
        "by_model": {m: stats(xs) for m, xs in sorted(by_model.items())},
        "by_rubric": {k: stats(xs) for k, xs in sorted(by_rubric.items())},
        "disagreements": [x for x in scored if x["promptfoo"] != x["custom"]],
    }


# -- 2. judges against the hand labels -------------------------------------------------------


def calibration_comparison(cal_dir: Path, judge: CachedJudge) -> dict[str, Any]:
    items = {
        i.id: i
        for i in (Item(**raw) for raw in yaml.safe_load(RESPONSES.read_text(encoding="utf-8")))
    }
    labels: dict[str, str] = yaml.safe_load(LABELS.read_text(encoding="utf-8"))
    pf: dict[str, list[Verdict]] = defaultdict(list)
    for row in _results(cal_dir):
        if _errored(row):
            continue
        item = items[row["vars"]["case_id"]]
        components = (row.get("gradingResult") or {}).get("componentResults") or []
        fake = Reply(
            "replay",
            _calibration_case(item),
            1,
            ParsedReply("", "", None),
            TrainerInput("", []),
            "",
            components,
        )
        pf[item.id].append(promptfoo_verdict(fake, item.rubric))
    out_rows: list[dict[str, Any]] = []
    verdicts: dict[str, dict[str, list[bool | None]]] = {"promptfoo": {}, "custom": {}}
    for item_id, item in items.items():
        p = pf.get(item_id, [])
        c = [judge.verdict(f"calibration|{item_id}|{n}") for n in (1, 2)]
        verdicts["promptfoo"][item_id] = [v.passed for v in p]
        verdicts["custom"][item_id] = [v.passed for v in c]
        out_rows.append(
            {
                "item": item_id,
                "rubric": item.rubric,
                "source": item.source,
                "label": labels[item_id] == "pass",
                "promptfoo": verdicts["promptfoo"][item_id],
                "promptfoo_reason": p[0].reason if p else "",
                "custom": verdicts["custom"][item_id],
                "custom_reason": c[0].reason,
            }
        )

    def grader(name: str) -> dict[str, Any]:
        first: list[tuple[bool, bool]] = []
        steady: list[bool] = []
        for item_id, runs in verdicts[name].items():
            if runs and runs[0] is not None:
                first.append((labels[item_id] == "pass", runs[0]))
            if len(runs) == 2 and None not in runs:
                steady.append(runs[0] == runs[1])
        stats = agreement(first)
        stats["self_consistency"] = f"{sum(steady)}/{len(steady)}"
        return stats

    return {"items": out_rows, "promptfoo": grader("promptfoo"), "custom": grader("custom")}


def _calibration_case(item: Item) -> Case:
    return Case(
        id=item.id,
        category="output_quality",
        kind="calibration",
        title=item.source,
        ask=item.question,
        judge=[item.rubric],
    )


def calibration_jobs(judge_runs: int = 2) -> list[tuple[str, str, str, str, str]]:
    items = [Item(**raw) for raw in yaml.safe_load(RESPONSES.read_text(encoding="utf-8"))]
    return [
        (f"calibration|{i.id}|{n}", i.rubric, i.question, i.reply, i.log)
        for i in items
        for n in range(1, judge_runs + 1)
    ]


# -- 3. rule checks, and fairness groups -----------------------------------------------------


def python_rules(reply: Reply, key: str) -> list[CheckResult]:
    return run_rules(
        reply.case.expect,
        reply.parsed,
        prompt_rules=static_rules(reply.system),
        secrets={"Claude API key": key},
    )


def rule_parity(replies: Sequence[Reply], key: str) -> dict[str, Any]:
    compared = 0
    mismatches = []
    for r in replies:
        py: dict[str, bool] = {}
        for result in python_rules(r, key):
            py[result.check] = py.get(result.check, True) and result.passed
        js: dict[str, bool] = {}
        for component in r.components:
            metric = _metric(component)
            if metric.startswith("rule:"):
                name = metric.removeprefix("rule:")
                js[name] = js.get(name, True) and bool(component.get("pass"))
        for check in sorted(set(py) | set(js)):
            compared += 1
            if py.get(check) != js.get(check):
                mismatches.append(
                    {
                        "model": r.label,
                        "case": r.case.id,
                        "check": check,
                        "checks.py": py.get(check),
                        "promptfoo": js.get(check),
                        "reply": r.parsed.raw[:300],
                    }
                )
    return {"compared": compared, "mismatches": mismatches}


def fairness(replies: Sequence[Reply], key: str, cases: Sequence[Case]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for label in sorted({r.label for r in replies}):
        runs: dict[str, list[Run]] = defaultdict(list)
        for r in replies:
            if r.label != label:
                continue
            judges = [
                JudgeResult(rubric, promptfoo_verdict(r, rubric).passed, "")
                for rubric in r.case.judge
            ]
            runs[r.case.id].append(Run(r.case, r.rep, r.parsed, python_rules(r, key), judges))
        asked = [c for c in cases if c.id in runs]  # only groups this run asked
        found = [score_group(g, runs) for g in groups(asked)]
        out[label] = [
            {
                "group": g.group,
                "status": g.status,
                "parity_gap": g.parity_gap,
                "differences": g.differences,
            }
            for g in found
        ]
    return out


# -- report ---------------------------------------------------------------------------------


def _cell(text: str, limit: int = 220) -> str:
    flat = " ".join(text.split()).replace("|", "/")
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _verdict(v: bool | None) -> str:
    return {True: "pass", False: "fail", None: "no verdict"}[v]


def render(report: dict[str, Any]) -> str:
    lines = [
        "# promptfoo vs the custom suite",
        "",
        f"Run: `{report['run']}`. Both graders use `{JUDGE_MODEL}` at low effort; they differ in "
        "harness and grading prompt (promptfoo's default llm-rubric prompt against the custom "
        "judge's hardened one with a structured verdict).",
        "",
        "## 1. Judges on the golden replies",
        "",
    ]
    if report["golden"]["overall"]["n"]:
        lines += _judges_section(report["golden"])
    else:
        lines.append("No llm-rubric verdicts in this run (rule checks only).")
    return _render_rest(report, lines)


def _judges_section(g: dict[str, Any]) -> list[str]:
    o = g["overall"]
    lines = [
        f"{o['n']} verdicts compared (no verdict: promptfoo {g['no_verdict']['promptfoo']}, "
        f"custom {g['no_verdict']['custom']}). **Agreement {pct(o['rate'])}** "
        f"({o['agree']}/{o['n']}), Cohen's kappa {o['kappa']:.2f}. Pass rate: custom judge "
        f"{pct(o['first_pass_rate'])}, promptfoo {pct(o['second_pass_rate'])}.",
        "",
        "| | promptfoo pass | promptfoo fail |",
        "|---|--:|--:|",
        f"| **custom pass** | {o['confusion']['both_pass']} | {o['confusion']['first_only']} |",
        f"| **custom fail** | {o['confusion']['second_only']} | {o['confusion']['both_fail']} |",
        "",
        "| Model | Verdicts | Agreement | Kappa | Custom pass rate | promptfoo pass rate |",
        "|---|--:|--:|--:|--:|--:|",
    ]
    for model, s in g["by_model"].items():
        lines.append(
            f"| {model} | {s['n']} | {pct(s['rate'])} | {s['kappa']:.2f} | "
            f"{pct(s['first_pass_rate'])} | {pct(s['second_pass_rate'])} |"
        )
    lines += [
        "",
        "| Rubric | Verdicts | Agreement | Custom pass rate | promptfoo pass rate |",
        "|---|--:|--:|--:|--:|",
    ]
    for rubric, s in g["by_rubric"].items():
        lines.append(
            f"| {rubric} | {s['n']} | {pct(s['rate'])} | {pct(s['first_pass_rate'])} | "
            f"{pct(s['second_pass_rate'])} |"
        )
    lines += ["", f"### Disagreements ({len(g['disagreements'])})", ""]
    for d in g["disagreements"]:
        lines += [
            f"- **`{d['case']}`** ({d['model']}, `{d['rubric']}`): "
            f"custom **{_verdict(d['custom'])}**, promptfoo **{_verdict(d['promptfoo'])}**.",
            f"  - Custom: {_cell(d['custom_reason'], 400)}",
            f"  - promptfoo: {_cell(d['promptfoo_reason'], 400)}",
            f"  - Reply: {_cell(d['reply'], 400)}",
        ]
    return lines


def _render_rest(report: dict[str, Any], lines: list[str]) -> str:
    if "calibration" in report:
        c = report["calibration"]
        lines += [
            "",
            "## 2. Judges against the hand labels (15 calibration replies)",
            "",
            "| Grader | Agreement with labels | Kappa | Self-consistency |",
            "|---|--:|--:|--:|",
        ]
        for name in ("custom", "promptfoo"):
            s = c[name]
            lines.append(
                f"| {name} | {pct(s['rate'])} ({s['agree']}/{s['n']}) | "
                f"{s['kappa']:.2f} | {s['self_consistency']} |"
            )
        lines += [
            "",
            "| Reply | Rubric | Label | Custom (2 runs) | promptfoo (2 runs) | Matched the label |",
            "|---|---|---|---|---|---|",
        ]
        for r in c["items"]:
            label = "pass" if r["label"] else "fail"
            matched = [
                name for name in ("custom", "promptfoo") if r[name] and r[name][0] == r["label"]
            ]
            lines.append(
                f"| {r['item']} | {r['rubric']} | {label} | "
                f"{' / '.join(_verdict(v) for v in r['custom'])} | "
                f"{' / '.join(_verdict(v) for v in r['promptfoo'])} | "
                f"{', '.join(matched) or 'neither'} |"
            )
        wrong = [
            r
            for r in c["items"]
            if any(r[n] and r[n][0] != r["label"] for n in ("custom", "promptfoo"))
        ]
        if wrong:
            lines += ["", "Where a grader missed the label:", ""]
            for r in wrong:
                for name in ("custom", "promptfoo"):
                    if r[name] and r[name][0] != r["label"]:
                        lines.append(
                            f"- `{r['item']}` ({r['rubric']}, {r['source']}): {name} said "
                            f"{_verdict(r[name][0])}: {_cell(r[f'{name}_reason'], 400)}"
                        )
    p = report["rules"]
    lines += [
        "",
        "## 3. Rule checks: checks.py against promptfoo's assertions",
        "",
        f"{p['compared']} (reply, check) pairs compared; "
        f"**{len(p['mismatches'])} scored differently**.",
    ]
    for m in p["mismatches"]:
        lines.append(
            f"- `{m['case']}` ({m['model']}) `{m['check']}`: checks.py {m['checks.py']}, "
            f"promptfoo {m['promptfoo']}. Reply: {_cell(m['reply'], 200)}"
        )
    lines += [
        "",
        "### Fairness groups (scored from the promptfoo replies by aievals/equivalence.py)",
        "",
        f"Runs per member: {report['reps']}. With one, parity is 0 or 1 per member; the custom "
        "live tier runs three. The pair judge (`equivalent_advice`) is not run here.",
        "",
        "| Model | Group | Status | Parity gap | Target differences |",
        "|---|---|---|--:|---|",
    ]
    for model, found in report["fairness"].items():
        for f in found:
            diffs = "; ".join(f"{k}: {', '.join(v)}" for k, v in f["differences"].items())
            lines.append(
                f"| {model} | {f['group']} | {f['status']} | {f['parity_gap']} | "
                f"{_cell(diffs) or '-'} |"
            )
    cost = report["cost"]
    lines += [
        "",
        f"Custom judge: {cost['calls']} verdicts, ${cost['usd']:.4f} at list price "
        f"(${cost['spent_this_run_usd']:.4f} spent by this invocation; the rest was cached).",
    ]
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    p.add_argument("run", type=Path, help="a promptfoo run dir (reports/promptfoo/<run>)")
    p.add_argument("--calibration", type=Path, help="a promptfoo calibration run dir")
    p.add_argument(
        "--yes", action="store_true", help="spend on the custom judge's missing verdicts"
    )
    a = p.parse_args(argv)

    dataset = load_dataset()
    cases = {c.id: c for c in dataset.cases}
    replies, errors = load_replies(a.run, cases)
    key = load_key() or ""
    jobs = judge_jobs(replies)
    cal_jobs = calibration_jobs() if a.calibration else []
    golden_judge = CachedJudge(a.run / "custom_judge.jsonl", None)
    cal_judge = CachedJudge(a.calibration / "custom_judge.jsonl", None) if a.calibration else None
    todo = [j for j in jobs if j[0] not in golden_judge.cache]
    todo_cal = [j for j in cal_jobs if cal_judge is not None and j[0] not in cal_judge.cache]
    if todo or todo_cal:
        n = len(todo) + len(todo_cal)
        expected = n * cost_usd(JUDGE_MODEL, EXPECTED_USAGE)
        worst = worst_case_usd([*todo, *todo_cal])
        print(
            f"Custom judge ({JUDGE_MODEL}): {n} verdicts to get ({len(todo)} golden, "
            f"{len(todo_cal)} calibration), expected about ${expected:.2f}, "
            f"worst case ${worst:.2f}."
        )
        if not a.yes:
            print("Nothing spent. Add --yes to get them.")
            return 0
        if not key:
            sys.exit(
                "No key: put ANTHROPIC_API_KEY_EVALS in ai-evals/.env.live or the environment."
            )
        client = anthropic.Anthropic(api_key=key, max_retries=3)
        golden_judge = CachedJudge(a.run / "custom_judge.jsonl", Judge(client))
        golden_judge.grade_all(todo)
        if a.calibration:
            cal_judge = CachedJudge(a.calibration / "custom_judge.jsonl", Judge(client))
            cal_judge.grade_all(todo_cal)

    keys = [j[0] for j in jobs if j[0] in golden_judge.cache]
    cal_keys = [j[0] for j in cal_jobs if cal_judge is not None and j[0] in cal_judge.cache]
    spent = golden_judge.spent + (cal_judge.spent if cal_judge else Usage())
    usage = golden_judge.total_usage(keys) + (
        cal_judge.total_usage(cal_keys) if cal_judge else Usage()
    )
    report: dict[str, Any] = {
        "run": a.run.name,
        "reps": max((r.rep for r in replies), default=0),
        "errors_not_scored": errors,
        "golden": golden_comparison(replies, golden_judge),
        "rules": rule_parity(replies, key),
        "fairness": fairness(replies, key, dataset.cases),
        "cost": {
            "calls": len(keys) + len(cal_keys),
            "usd": cost_usd(JUDGE_MODEL, usage),
            "spent_this_run_usd": cost_usd(JUDGE_MODEL, spent),
        },
    }
    if a.calibration and cal_judge is not None:
        report["calibration"] = calibration_comparison(a.calibration, cal_judge)
        report["calibration_run"] = a.calibration.name
    markdown = render(report)
    (a.run / "comparison.json").write_text(
        json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    (a.run / "comparison.md").write_text(markdown, encoding="utf-8")
    print(markdown)
    print(f"Wrote {a.run / 'comparison.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
