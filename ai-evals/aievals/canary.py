"""The production canary: a fixed set of eval cases through the REAL deployed trainer.

    python -m aievals.canary run [--judge] [--drill infrastructure|quality]
    python -m aievals.canary alert <summary.json> --history <prod-canary.json> --out <alerts.json>
    python -m aievals.canary publish <history.json> <summary.json> [--alerts <alerts.json>]
    python -m aievals.canary snapshot    # rebuild canary/snapshot.txt (needs the local stack)

Shift-right. The live tier proves the model behaves before a release; this
proves the deployed feature still does, every six hours
(.github/workflows/prod-canary.yml), and raises a GitHub issue when it doesn't
(aievals/alerts.py). It is a monitor, outside the release gate: nothing here
can block or slow a deploy.

What it does to production, and nothing else:

- signs the monitor account in (Supabase Auth, password grant) and out again;
- POSTs the canary questions to /api/trainer exactly as the browser does.
  The function has no database access and writes nothing; the "Remember" chip a
  reply may carry is only ever saved by a tap in the app, and the canary never
  taps. No row is created, no counter moves, and the account stays empty.

The log the browser would send is a fixed fixture (canary/snapshot.txt): the
Sam persona's real snapshot, built by the app's own trainerContext.ts, with its
dates made relative so every run asks the same questions about the same data.
The replies are parsed by the app's own parser (ai-evals/harness), never a
re-implementation.

Limits, all checked before anything is spent: a worst-case cost cap
(--max-usd, default $0.25), a hard call cap, one call at a time (so latency is
measured on an idle connection), a per-call timeout and the workflow's own.
Production reports no token counts, so the cost it prints is an estimate from
characters at list prices, and says so; the judge's cost is real.
"""

import argparse
import contextlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

import anthropic
import httpx
import yaml
from pydantic import Field

from aievals import alerts
from aievals.checks import run_rules
from aievals.dataset import ROOT, Case, Dataset, Strict, load_dataset
from aievals.harness import ClientHarness, ParsedReply, TrainerInput
from aievals.judge import JUDGE_MODEL, NEEDS_LOG, Grader, Judge
from aievals.latency import Sample, report
from aievals.live import (
    ACCOUNT_FAILURES,
    JUDGE_MAX_TOKENS,
    KEY_VAR,
    MAX_TRIES,
    NO_ANSWER,
    REASON_CODE,
    TRAINER_MAX_TOKENS,
    TRAINER_MODEL,
    TRANSIENT,
    check_key,
    judge_log,
    load_key,
    shown_to_judge,
)
from aievals.personas import seed_persona
from aievals.pricing import Usage, cost_usd
from aievals.prompt import rules_from_source
from aievals.scoring import CaseOutcome, JudgeResult, Run, case_outcomes
from aievals.thresholds import BARS, LATENCY_BUDGETS_MS
from testkit.auth import AdminAuth, AuthClient
from testkit.config import Settings
from testkit.functions import FunctionsClient
from testkit.leaks import find_leaks
from testkit.rest import RestClient
from testkit.users import UserFactory

REPO = ROOT.parent
CANARY_DIR = ROOT / "canary"
CASES_FILE = CANARY_DIR / "cases.yaml"
SNAPSHOT_FILE = CANARY_DIR / "snapshot.txt"
SNAPSHOT_META = CANARY_DIR / "snapshot.json"
TRAINER_CONTEXT_SOURCE = REPO / "src" / "lib" / "trainerContext.ts"
REPORTS = REPO / "reports" / "prod-canary"
ENV_FILE = ROOT / ".env.canary"
HISTORY_CAP = 360  # 90 days at four runs a day
DEFAULT_SITE = "https://fitlog-prod.pages.dev"
# A failed case is asked once more before it counts: the live tier runs every
# case three times for the same reason (the model's wording varies).
ATTEMPTS_PER_CASE = 2
CHARS_PER_TOKEN = 3  # the live tier's conservative figure (English is about 4)
PROMPT_OVERHEAD_CHARS = 400  # the data-block tags and headings around the snapshot
# How many cases a drill asks: enough to prove the alert, not a full run's cost.
DRILL_CASES = 3
DRILL_SITE = "https://prod-canary-drill.invalid"  # no such host: every call fails, free
DRILL_CANARY = "CANARY-DRILL-7731"  # no reply contains it, so every quality check fails

Drill = Literal["infrastructure", "quality"]
Parser = Callable[[str], ParsedReply]

# The variables the canary needs, and what each one is (for the error message).
VARS = {
    "CANARY_SITE_URL": f"the deployed site, e.g. {DEFAULT_SITE}",
    "CANARY_SUPABASE_URL": "that site's Supabase project URL (the browser's VITE_SUPABASE_URL)",
    "CANARY_SUPABASE_ANON_KEY": "its anon/publishable key (VITE_SUPABASE_ANON_KEY)",
    "CANARY_EMAIL": "the monitor account's email (a user that exists only for this)",
    "CANARY_PASSWORD": "the monitor account's password",
}


@dataclass(frozen=True)
class Target:
    """Where the canary points. Keys stay out of repr() so they never land in a log."""

    site_url: str
    supabase_url: str
    anon_key: str = field(repr=False)
    email: str = field(repr=False)
    password: str = field(repr=False)


@dataclass(frozen=True)
class Options:
    judge: bool = False
    drill: Drill | None = None
    max_usd: float = 0.25
    # p95 budget per category (aievals/thresholds.py); tests pass their own.
    latency_budgets_ms: dict[str, int] = field(default_factory=lambda: dict(LATENCY_BUDGETS_MS))
    call_timeout_s: float = 60.0
    out: Path = REPORTS


@dataclass(frozen=True)
class Timing:
    first_byte_ms: int
    total_ms: int


@dataclass(frozen=True)
class Attempt:
    case: Case
    attempt: int  # 1, or 2 for the confirmation of a failed first attempt
    raw: str | None
    error: str | None
    tries: int
    timing: Timing | None


class CanaryCase(Strict):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    why: str


class CanarySet(Strict):
    cases: list[CanaryCase]


# -- configuration -------------------------------------------------------------------------


def _env_file_values(path: Path = ENV_FILE) -> dict[str, str]:
    """NAME=value lines, read as utf-8-sig like live.py's key file."""
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip():
                values[name.strip()] = value.strip().strip("\"'")
    return values


def load_target(env: dict[str, str] | None = None) -> Target:
    """The target from the environment, else ai-evals/.env.canary; a missing value stops."""
    source = {**_env_file_values(), **(env if env is not None else dict(os.environ))}
    values = {name: source.get(name, "").strip() for name in VARS}
    if not values["CANARY_SITE_URL"]:
        values["CANARY_SITE_URL"] = DEFAULT_SITE
    missing = [name for name, value in values.items() if not value]
    if missing:
        wanted = "\n".join(f"  {name}: {VARS[name]}" for name in missing)
        sys.exit(
            f"The canary needs these, in the environment or in {ENV_FILE.name} (gitignored):\n"
            f"{wanted}"
        )
    return Target(
        site_url=values["CANARY_SITE_URL"].rstrip("/"),
        supabase_url=values["CANARY_SUPABASE_URL"].rstrip("/"),
        anon_key=values["CANARY_SUPABASE_ANON_KEY"],
        email=values["CANARY_EMAIL"],
        password=values["CANARY_PASSWORD"],
    )


def load_canary_cases(dataset: Dataset, path: Path = CASES_FILE) -> list[Case]:
    """The canary set, resolved against the full dataset; unknown ids stop."""
    chosen = CanarySet.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    by_id = {c.id: c for c in dataset.cases}
    unknown = [c.id for c in chosen.cases if c.id not in by_id]
    if unknown:
        raise ValueError(f"{path.name} names cases that don't exist: {unknown}")
    return [by_id[c.id] for c in chosen.cases]


# -- the snapshot fixture ------------------------------------------------------------------

ISO_DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
TOKEN = re.compile(r"\{\{today(?:([+-])(\d+))?\}\}")


def template_snapshot(text: str, generated_on: date) -> str:
    """Every date in a snapshot replaced by its offset from the day it was built."""

    def token(m: re.Match[str]) -> str:
        delta = (generated_on - date.fromisoformat(m.group(1))).days
        if delta == 0:
            return "{{today}}"
        return "{{today-" + str(delta) + "}}" if delta > 0 else "{{today+" + str(-delta) + "}}"

    return ISO_DATE.sub(token, text)


def render_snapshot(template: str, today: date) -> str:
    """The fixture as it would read if the app built it today."""

    def value(m: re.Match[str]) -> str:
        sign, days = m.group(1), m.group(2)
        if not sign:
            return today.isoformat()
        delta = timedelta(days=int(days))
        return (today - delta if sign == "-" else today + delta).isoformat()

    return TOKEN.sub(value, template)


def load_snapshot(today: date) -> str:
    return render_snapshot(SNAPSHOT_FILE.read_text(encoding="utf-8").rstrip("\n"), today)


def _blob(path: Path) -> str:
    """Git's hash of the file as it is in the working tree ("" without git)."""
    git = shutil.which("git")
    if git is None or not path.exists():
        return ""
    done = subprocess.run(  # noqa: S603 (fixed arguments)
        [git, "hash-object", str(path)], capture_output=True, text=True, check=False
    )
    return done.stdout.strip()


def snapshot_status() -> dict[str, Any]:
    """When the fixture was built, and whether trainerContext.ts has changed since.

    A stale fixture is reported, never fatal: the canary still measures the
    deployed endpoint, it just sends the log as an older build would have.
    """
    meta = json.loads(SNAPSHOT_META.read_text(encoding="utf-8")) if SNAPSHOT_META.exists() else {}
    current = _blob(TRAINER_CONTEXT_SOURCE)
    recorded = meta.get("trainer_context_blob", "")
    return {
        "generated": meta.get("generated"),
        "stale": None if not (current and recorded) else current != recorded,
    }


# -- cost --------------------------------------------------------------------------------


def _prompt_chars(rules: str, given: TrainerInput, case: Case) -> int:
    chars = len(rules) + len(given.context) + sum(map(len, given.memory)) + len(case.ask)
    chars += sum(len(t.content) for t in case.history)
    return chars + PROMPT_OVERHEAD_CHARS


def upper_bound_usd(
    cases: Sequence[Case], rules: str, given: TrainerInput, judge: bool, attempts: int
) -> float:
    """The most a run could cost: every attempt, every reply at its token ceiling."""
    trainer = judged = 0.0
    for case in cases:
        prompt = _prompt_chars(rules, given, case)
        trainer += cost_usd(TRAINER_MODEL, Usage(prompt // CHARS_PER_TOKEN, TRAINER_MAX_TOKENS))
        if judge:
            for rubric in case.judge:
                chars = 2_500 + len(case.ask) + TRAINER_MAX_TOKENS * 4
                chars += len(given.context) if rubric in NEEDS_LOG else 0
                judged += cost_usd(JUDGE_MODEL, Usage(chars // CHARS_PER_TOKEN, JUDGE_MAX_TOKENS))
    return (trainer + judged) * attempts


def estimated_usage(rules: str, given: TrainerInput, case: Case, reply: str) -> Usage:
    """What one answered call probably cost, from characters (production reports no tokens)."""
    return Usage(
        _prompt_chars(rules, given, case) // CHARS_PER_TOKEN, len(reply) // CHARS_PER_TOKEN
    )


# -- talking to the deployed site -----------------------------------------------------------


class CallBudget:
    """A hard cap on calls, enforced in-process (the only caller is this process)."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.used = 0

    def admit(self) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


def ask_once(
    http: httpx.Client,
    site_url: str,
    token: str,
    case: Case,
    given: TrainerInput,
    timeout_s: float,
) -> tuple[str | None, str | None, Timing | None]:
    """One POST to /api/trainer, streamed as the app reads it, timed to first byte and end."""
    trainer = FunctionsClient(http, site_url, token)
    try:
        resp = trainer.ask_trainer_timed(
            case.ask,
            history=[t.model_dump() for t in case.history],
            context=given.context,
            memory=given.memory,
            timeout=httpx.Timeout(timeout_s, connect=10),
        )
    except httpx.HTTPError as e:
        return None, f"no response ({type(e).__name__})", None
    if resp.status == 200 and resp.text and not resp.text.startswith(NO_ANSWER):
        return resp.text, None, Timing(resp.first_byte_ms, resp.total_ms)
    return None, f"HTTP {resp.status}: {resp.text[:160]}", None


def ask(
    http: httpx.Client,
    site_url: str,
    token: str,
    case: Case,
    attempt: int,
    given: TrainerInput,
    budget: CallBudget,
    stop: list[str],
    timeout_s: float,
    max_tries: int = MAX_TRIES,
) -> Attempt:
    """One attempt, retrying only failures that can pass on a second try (live.py's rules).

    `stop` holds the reason once the account can't answer at all (no credit, a
    rejected key): the rest of the run is then skipped instead of spent.
    """
    error: str | None = None
    tries = 0
    while tries < max_tries and not stop:
        if not budget.admit():
            return Attempt(
                case, attempt, None, "skipped: the run's call budget is spent", tries, None
            )
        tries += 1
        raw, error, timing = ask_once(http, site_url, token, case, given, timeout_s)
        if raw is not None:
            return Attempt(case, attempt, raw, None, tries, timing)
        error = error or "no reply"
        code = m.group(1) if (m := REASON_CODE.search(error)) else ""
        if code in ACCOUNT_FAILURES:
            stop.append(code)
        if error.startswith("HTTP") and code not in TRANSIENT:
            break
        if tries < max_tries and not stop:
            time.sleep(2**tries + random.uniform(0, 1))  # noqa: S311 (jitter, not crypto)
    return Attempt(
        case, attempt, None, error or f"skipped: the account can't answer ({stop[0]})", tries, None
    )


def sign_in(http: httpx.Client, target: Target) -> tuple[str | None, str]:
    """The monitor account's access token, or why there is none (never the body verbatim)."""
    auth = AuthClient(http, target.supabase_url, target.anon_key)
    try:
        resp = auth.sign_in(target.email, target.password)
    except httpx.HTTPError as e:
        return None, f"failed: no response ({type(e).__name__})"
    if resp.status_code != 200:
        why = ""
        with contextlib.suppress(ValueError):
            why = str(resp.json().get("error_description") or resp.json().get("msg") or "")
        return None, f"failed: HTTP {resp.status_code}" + (f" ({why[:80]})" if why else "")
    token = resp.json().get("access_token")
    if not isinstance(token, str) or not token:
        return None, "failed: the sign-in response carried no access token"
    return token, "ok"


def sign_out(http: httpx.Client, target: Target, token: str) -> None:
    # A session left to expire is not worth failing the run over.
    with contextlib.suppress(httpx.HTTPError):
        AuthClient(http, target.supabase_url, target.anon_key).sign_out(token)


# -- scoring -------------------------------------------------------------------------------


def with_drill(cases: Sequence[Case], drill: Drill | None) -> list[Case]:
    """The cases a drill runs: fewer, and for a quality drill each with a check no reply meets."""
    if drill is None:
        return list(cases)
    chosen = list(cases)[:DRILL_CASES]
    if drill == "infrastructure":
        return chosen
    # The case's own anchors are replaced, not extended: contains_any is "any of".
    return [
        c.model_copy(
            update={"expect": c.expect.model_copy(update={"contains_any": [DRILL_CANARY]})}
        )
        for c in chosen
    ]


def quality_failures(outcomes: Sequence[CaseOutcome]) -> list[CaseOutcome]:
    """Cases that failed by their category's bar.

    A category whose live-tier bar is 100% (the security categories) fails on any
    failed attempt: an attack that works once works. Elsewhere a case fails only
    when both attempts failed; failed-then-passed is reported as inconsistent.
    """
    failed = []
    for o in outcomes:
        if o.runs == 0:
            continue  # unscored: an infrastructure matter, reported separately
        strict = BARS[o.case.category].rule >= 1.0
        if (strict and o.passes < o.runs) or o.passes == 0:
            failed.append(o)
    return failed


SECRET_SAMPLE = re.compile(r" \('.*?'\)")  # the quoted sample find_leaks puts in its detail


def failure_detail(runs: Sequence[Run]) -> str:
    """What failed, as one readable line that can go in a public issue.

    Never the reply text, and never the value a secrets check matched: a leaked
    key must not be copied from the reply into the alert.
    """
    failed = [r for r in runs if not r.passed] or list(runs)
    last = failed[-1]
    parts = [
        f"{c.check}: {SECRET_SAMPLE.sub('', c.detail) if c.check == 'no_secrets' else c.detail}"
        if c.detail
        else f"{c.check}: failed"
        for c in last.rules
        if not c.passed
    ]
    parts += [f"judge {j.rubric}: {j.reason}" for j in last.judges if j.passed is False]
    detail = "; ".join(parts) or "failed"
    if len(runs) > 1:
        detail += f" ({len(failed)} of {len(runs)} attempts failed)"
    return detail


# -- the run --------------------------------------------------------------------------------


def _harness_parser(target: Target) -> Parser:
    ClientHarness.build()
    harness = ClientHarness(target.supabase_url, target.anon_key)
    return harness.parse_one


def _git_sha() -> str:
    git = shutil.which("git")
    if git is None:
        return ""
    done = subprocess.run(  # noqa: S603 (fixed arguments)
        [git, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
    )
    return done.stdout.strip()


def _run_url() -> str | None:
    run_id = os.environ.get("GITHUB_RUN_ID")
    if not run_id:
        return None
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    return f"{server}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{run_id}"


def run(
    opts: Options,
    *,
    target: Target | None = None,
    http: httpx.Client | None = None,
    parser: Parser | None = None,
    grader: Grader | None = None,
    today: date | None = None,
) -> int:
    """The whole canary. Exit code 0: pass, 1: something to alert on, 2: refused to start."""
    target = target or load_target()
    dataset = load_dataset()
    cases = with_drill(load_canary_cases(dataset), opts.drill)
    today = today or date.today()
    given = TrainerInput(load_snapshot(today), list(dataset.personas["sam"].memory))
    rules = rules_from_source()

    key = None
    if opts.judge and grader is None:
        key = load_key()
        if key is None:
            sys.exit(f"--judge needs {KEY_VAR} (the live tier's key) in the environment.")
    bound = upper_bound_usd(cases, rules, given, opts.judge, ATTEMPTS_PER_CASE)
    if bound > opts.max_usd:
        print(
            f"Refusing to start: this run could cost up to ${bound:.2f} "
            f"(limit ${opts.max_usd:.2f})."
        )
        return 2
    if key is not None:
        check_key(key)
        grader = Judge(anthropic.Anthropic(api_key=key, max_retries=3))

    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + (
        f"-drill-{opts.drill}" if opts.drill else ""
    )
    site = DRILL_SITE if opts.drill == "infrastructure" else target.site_url
    max_tries = 1 if opts.drill else MAX_TRIES
    budget = CallBudget(len(cases) * ATTEMPTS_PER_CASE * max_tries)
    print(
        f"Canary: {len(cases)} cases against {site}, at most {budget.limit} calls, "
        f"at most ${bound:.2f}" + (f" (drill: {opts.drill})" if opts.drill else ""),
        flush=True,
    )

    own_http = http is None
    http = http or httpx.Client(timeout=30)
    parse = parser
    attempts: list[Attempt] = []
    runs: list[Run] = []
    stop: list[str] = []
    token: str | None
    try:
        if opts.drill == "infrastructure":
            token, signed_in = "drill", "ok"  # no sign-in: the site is fake and nothing is spent
        else:
            token, signed_in = sign_in(http, target)
        if token is not None:
            secrets = {"the monitor's session token": token}
            try:
                for case in cases:
                    for attempt_no in range(1, ATTEMPTS_PER_CASE + 1):
                        a = ask(
                            http,
                            site,
                            token,
                            case,
                            attempt_no,
                            given,
                            budget,
                            stop,
                            opts.call_timeout_s,
                            max_tries,
                        )
                        attempts.append(a)
                        if a.raw is None:
                            break  # no reply to score; a second attempt would say nothing new
                        if (
                            parse is None
                        ):  # built on first use: a drill with no replies needs no Node
                            parse = _harness_parser(target)
                        reply = parse(a.raw)
                        checks = run_rules(case.expect, reply, prompt_rules=rules, secrets=secrets)
                        verdicts: list[JudgeResult] = []
                        if grader is not None:
                            verdicts = [
                                grader.grade(r, case.ask, shown_to_judge(reply), judge_log(given))
                                for r in case.judge
                            ]
                        scored = Run(
                            case,
                            attempt_no,
                            reply,
                            checks,
                            verdicts,
                            a.timing.total_ms if a.timing else 0,
                        )
                        runs.append(scored)
                        if scored.passed:
                            break
            finally:
                if opts.drill != "infrastructure":
                    sign_out(http, target, token)
    finally:
        if own_http:
            http.close()

    summary = build_summary(
        run_id=run_id,
        site=site,
        opts=opts,
        cases=cases,
        attempts=attempts,
        runs=runs,
        signed_in=signed_in,
        rules=rules,
        given=given,
        grader=grader,
    )
    markdown = render_markdown(summary)
    _write(opts.out / run_id, summary, markdown, runs, attempts, rules)
    (opts.out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(markdown)
    if step_summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(step_summary, "a", encoding="utf-8") as f:
            f.write(markdown)
    return 0 if summary["status"] == "pass" else 1


def build_summary(
    *,
    run_id: str,
    site: str,
    opts: Options,
    cases: Sequence[Case],
    attempts: Sequence[Attempt],
    runs: Sequence[Run],
    signed_in: str,
    rules: str,
    given: TrainerInput,
    grader: Grader | None,
) -> dict[str, Any]:
    by_case: dict[str, list[Run]] = {}
    for r in runs:
        by_case.setdefault(r.case.id, []).append(r)
    outcomes = case_outcomes(cases, runs)
    failed = quality_failures(outcomes)
    failed_ids = {o.case.id for o in failed}
    scored = [o for o in outcomes if o.runs]
    errors = [{"case": a.case.id, "error": a.error} for a in attempts if a.raw is None]
    latency = report(
        [
            Sample(a.case.category, a.timing.total_ms, a.timing.first_byte_ms)
            for a in attempts
            if a.timing is not None
        ],
        opts.latency_budgets_ms,
    )
    trainer_usage = sum((estimated_usage(rules, given, r.case, r.reply.raw) for r in runs), Usage())
    judge_usage = sum((j.usage for r in runs for j in r.judges), Usage())
    judge_calls = sum(len(r.judges) for r in runs)
    judge_errors = sum(1 for r in runs for j in r.judges if j.passed is None)
    infra_ok = signed_in == "ok" and not errors and (latency is None or latency["ok"])
    quality_ok: bool | None = None if not scored else not failed
    return {
        "run_id": run_id,
        "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        "git_sha": _git_sha(),
        "site": site,
        "drill": opts.drill,
        "judge": grader is not None,
        "model": TRAINER_MODEL,  # what functions/api/trainer.ts asks for; production reports none
        "cases": len(cases),
        "scored": len(scored),
        "attempts": len(attempts),
        "status": "pass" if infra_ok and quality_ok else "fail",
        "infrastructure": {"ok": infra_ok, "sign_in": signed_in, "errors": errors},
        "quality": {
            "ok": quality_ok,
            "passed": sum(1 for o in scored if o.case.id not in failed_ids),
            "failed": [
                {
                    "id": o.case.id,
                    "title": o.case.title,
                    "detail": failure_detail(by_case[o.case.id]),
                }
                for o in failed
            ],
            "inconsistent": [
                o.case.id
                for o in scored
                if o.status == "inconsistent" and o.case.id not in failed_ids
            ],
            "judge_errors": judge_errors,
        },
        "latency": latency,
        "cost": {
            "estimated": True,
            "trainer_usd": round(cost_usd(TRAINER_MODEL, trainer_usage), 4),
            "judge_usd": round(cost_usd(JUDGE_MODEL, judge_usage), 4) if judge_calls else 0.0,
            "total_usd": round(
                cost_usd(TRAINER_MODEL, trainer_usage)
                + (cost_usd(JUDGE_MODEL, judge_usage) if judge_calls else 0.0),
                4,
            ),
            "bound_usd": round(
                upper_bound_usd(cases, rules, given, grader is not None, ATTEMPTS_PER_CASE), 4
            ),
            "cap_usd": opts.max_usd,
            "trainer_calls": len(runs),  # answered, so the estimate above is per answer
            "requests": sum(a.tries for a in attempts),
            "judge_calls": judge_calls,
        },
        "snapshot": snapshot_status(),
        "run_url": _run_url(),
        "alerts": {},
    }


def render_markdown(s: dict[str, Any]) -> str:
    q, i, lat, cost = s["quality"], s["infrastructure"], s["latency"], s["cost"]
    quality = (
        "nothing scored"
        if q["ok"] is None
        else f"{q['passed']} of {s['scored']} cases passed"
        + (
            f"; failed: {', '.join('`' + f['id'] + '`' for f in q['failed'])}"
            if q["failed"]
            else ""
        )
        + (
            f"; inconsistent: {', '.join('`' + c + '`' for c in q['inconsistent'])}"
            if q["inconsistent"]
            else ""
        )
    )
    endpoint = "ok" if i["ok"] else f"sign-in {i['sign_in']}" if i["sign_in"] != "ok" else ""
    if i["errors"]:
        endpoint = f"{len(i['errors'])} of {s['attempts']} calls got no answer"
    if lat is not None and not lat["ok"]:
        endpoint = (endpoint + "; " if endpoint and endpoint != "ok" else "") + (
            f"p95 over budget in {', '.join(lat['over_budget'])}"
        )
    latency = (
        "no answers to time"
        if lat is None
        else f"p50 {lat['p50_ms']:,} ms, p95 {lat['p95_ms']:,} ms, "
        f"first byte p50 {lat['first_byte_p50_ms']:,} ms; per category p95 (budget): "
        + ", ".join(
            f"{c} {m['p95_ms']:,} ({m['budget_p95_ms']:,})" for c, m in lat["categories"].items()
        )
    )
    lines = [
        f"## Production AI canary: {s['status'].upper()}"
        + (f" (drill: {s['drill']})" if s["drill"] else ""),
        "",
        f"{s['site']}, run `{s['run_id']}`, {s['cases']} cases in {s['attempts']} calls, "
        f"model `{s['model']}`" + (", judged" if s["judge"] else "") + ".",
        "",
        "| | |",
        "|---|---|",
        f"| Endpoint | {endpoint or 'ok'} |",
        f"| Quality | {quality} |",
        f"| Latency | {latency} |",
        f"| Cost | about ${cost['total_usd']:.3f} (estimated from characters; worst case "
        f"${cost['bound_usd']:.2f}, cap ${cost['cap_usd']:.2f}) |",
    ]
    if s["snapshot"].get("stale"):
        lines.append(
            "\n`trainerContext.ts` has changed since the snapshot fixture was built: "
            "run `python -m aievals.canary snapshot` against the local stack."
        )
    return "\n".join(lines) + "\n"


def _write(
    out: Path,
    summary: dict[str, Any],
    markdown: str,
    runs: Sequence[Run],
    attempts: Sequence[Attempt],
    rules: str,
) -> None:
    """Full transcripts per attempt, so any score can be traced (artifacts, never the issue)."""
    out.mkdir(parents=True, exist_ok=True)
    timing = {(a.case.id, a.attempt): a for a in attempts}
    rows = []
    for r in runs:
        a = timing[(r.case.id, r.rep)]
        rows.append(
            {
                "case": r.case.id,
                "category": r.case.category,
                "attempt": r.rep,
                "ask": r.case.ask,
                "reply": r.reply.raw,
                "shown": r.reply.text,
                "remember": r.reply.remember,
                "passed": r.passed,
                "rules": [asdict(c) for c in r.rules],
                "judges": [asdict(j) for j in r.judges],
                "first_byte_ms": a.timing.first_byte_ms if a.timing else None,
                "total_ms": a.timing.total_ms if a.timing else None,
                "tries": a.tries,
            }
        )
    rows += [
        {"case": a.case.id, "attempt": a.attempt, "error": a.error, "tries": a.tries}
        for a in attempts
        if a.raw is None
    ]
    (out / "results.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8"
    )
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (out / "summary.md").write_text(markdown, encoding="utf-8")
    (out / "prompt_rules.txt").write_text(rules, encoding="utf-8")


# -- alert, publish, snapshot --------------------------------------------------------------


def _load_history(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    history: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))
    return history


def alert(summary_path: Path, history_path: Path | None, out: Path | None, repo: str | None) -> int:
    """Turn a run's summary into the right GitHub issue action, and record what was done."""
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    findings = alerts.evaluate(summary, _load_history(history_path))
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repo = repo or os.environ.get("GITHUB_REPOSITORY", "")
    result: dict[alerts.Kind, dict[str, Any]] | None = None
    if token and repo:
        with alerts.github_client(token) as http:
            try:
                result = alerts.reconcile(alerts.GitHubIssues(http, repo), findings, summary)
            except httpx.HTTPStatusError as e:
                print(
                    f"GitHub refused: {e.response.status_code} on "
                    f"{e.request.method} {e.request.url.path}"
                )
                return 1
    else:
        print("No GITHUB_TOKEN/GITHUB_REPOSITORY: assessing only, no issue is touched.")
    text = alerts.describe(findings, result)
    print(text)
    if step_summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(step_summary, "a", encoding="utf-8") as f:
            f.write(
                "\n**Alerts**\n\n" + "\n".join(f"- {line}" for line in text.splitlines()) + "\n"
            )
    if out is not None:
        taken = result or {}
        record: dict[str, Any] = {
            kind: taken.get(kind, {}).get("action", "not-run") for kind in alerts.KINDS
        }
        record["issues"] = {k: v["issue"] for k, v in taken.items() if v.get("issue")}
        out.write_text(json.dumps(record, indent=1), encoding="utf-8")
    return 0


def publish(history_path: Path, summary_path: Path, alerts_path: Path | None) -> int:
    """Append a run to the dashboard's history (re-runs replace themselves), keeping the newest."""
    record = json.loads(summary_path.read_text(encoding="utf-8"))
    if alerts_path is not None and alerts_path.exists():
        record["alerts"] = json.loads(alerts_path.read_text(encoding="utf-8"))
    history = [r for r in _load_history(history_path) if r.get("run_id") != record["run_id"]]
    history = [*history, record][-HISTORY_CAP:]
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(history, indent=1), encoding="utf-8")
    print(f"canary: {len(history)} runs in {history_path}")
    return 0


def snapshot() -> int:
    """Rebuild the fixture from a Sam seeded into the local stack, through the app's own code."""
    settings = Settings.from_env()
    dataset = load_dataset()
    ClientHarness.build()
    harness = ClientHarness(settings.supabase_url, settings.anon_key)
    today = date.today()
    with httpx.Client(timeout=30) as http:
        users = UserFactory(
            AdminAuth(http, settings.supabase_url, settings.service_role_key),
            AuthClient(http, settings.supabase_url, settings.anon_key),
            "canary",
        )
        try:
            user = users.create("snapshot")
            api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
            seed_persona(api, user.id, dataset.personas["sam"], today)
            given = harness.trainer_input(user)
        finally:
            users.delete_all()
    leaks = find_leaks(given.context)
    if leaks:
        sys.exit(f"the snapshot contains something that must not be committed: {leaks}")
    CANARY_DIR.mkdir(exist_ok=True)
    SNAPSHOT_FILE.write_text(template_snapshot(given.context, today) + "\n", encoding="utf-8")
    SNAPSHOT_META.write_text(
        json.dumps(
            {
                "generated": today.isoformat(),
                "persona": "sam",
                "git_sha": _git_sha(),
                "trainer_context_blob": _blob(TRAINER_CONTEXT_SOURCE),
                "memory_items": len(given.memory),
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {SNAPSHOT_FILE} ({len(given.context)} chars) and {SNAPSHOT_META.name}.")
    return 0


# -- CLI --------------------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("run", help="the canary against the configured site")
    r.add_argument("--judge", action="store_true", help="also run the LLM judge (costs more)")
    r.add_argument(
        "--drill", choices=("infrastructure", "quality"), help="break the run on purpose"
    )
    r.add_argument(
        "--max-usd", type=float, default=Options.max_usd, help="refuse runs that could cost more"
    )
    r.add_argument(
        "--call-timeout", type=float, default=Options.call_timeout_s, help="seconds per call"
    )
    r.add_argument("--out", type=Path, default=REPORTS)

    a = sub.add_parser("alert", help="open, comment on or close the alert issues for a run")
    a.add_argument("summary", type=Path)
    a.add_argument("--history", type=Path, help="data/prod-canary.json, for baselines")
    a.add_argument("--out", type=Path, help="where to record the actions taken (alerts.json)")
    a.add_argument("--repo", help="owner/name (default: GITHUB_REPOSITORY)")

    pub = sub.add_parser("publish", help="append a run to the dashboard history")
    pub.add_argument("history", type=Path)
    pub.add_argument("summary", type=Path)
    pub.add_argument("--alerts", type=Path)

    sub.add_parser("snapshot", help="rebuild canary/snapshot.txt from the local stack")
    return p.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    a = parse_args(argv)
    if a.command == "run":
        return run(
            Options(
                judge=a.judge,
                drill=a.drill,
                max_usd=a.max_usd,
                call_timeout_s=a.call_timeout,
                out=a.out,
            )
        )
    if a.command == "alert":
        return alert(a.summary, a.history, a.out, a.repo)
    if a.command == "publish":
        return publish(a.history, a.summary, a.alerts)
    return snapshot()


if __name__ == "__main__":
    sys.exit(main())
