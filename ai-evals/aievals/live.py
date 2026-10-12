"""The live tier: the eval dataset against the real Claude API, through the real function.

    python -m aievals.live                          # every case, 3 runs each
    python -m aievals.live --only q-math-shake --reps 1
    python -m aievals.live --dry-run                # the whole pipeline on the stub, for $0

Needs the local stack (make stack-up) and, unless --dry-run, an Anthropic key in
ANTHROPIC_API_KEY_EVALS or ai-evals/.env.live. Every user is synthetic: seeded
into the local stack for this run and deleted afterwards, so no real user's data
is ever sent to Claude.

Limits, all checked before anything is spent: at most --max-trainer-calls
trainer calls (the proxy enforces it again and refuses the rest), at most
--max-judge-calls judge calls, and an upper-bound cost under --max-usd. The
printed cost is computed from the token counts the API reported.

Starts its own functions server (api-tests/scripts/start-functions.sh), which
replaces one that script already had running.
"""

import argparse
import json
import os
import random
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import anthropic
import httpx

from aievals.checks import run_rules
from aievals.dataset import ROOT, Case, Dataset, load_dataset
from aievals.harness import ClientHarness, ParsedReply, TrainerInput
from aievals.judge import JUDGE_MODEL, NEEDS_LOG, DryJudge, Grader, Judge
from aievals.personas import seed_persona, with_seed
from aievals.pricing import Usage, cost_usd, price
from aievals.prompt import static_rules
from aievals.proxy import ClaudeProxy, ProxiedCall
from aievals.report import Cost, append_history, build_summary, render_markdown
from aievals.scoring import JudgeResult, Run, case_outcomes, category_gates
from testkit.anthropic_stub import AnthropicStub
from testkit.auth import AdminAuth, AuthClient, SignedInUser
from testkit.config import FAKE_ANTHROPIC_KEY, Settings
from testkit.functions import FunctionsClient
from testkit.rest import RestClient
from testkit.users import UserFactory

REPO = ROOT.parent
REPORTS = REPO / "reports" / "ai-evals-live"
TRAINER_MODEL = "claude-haiku-4-5"  # functions/api/trainer.ts
TRAINER_MAX_TOKENS = 700  # functions/api/trainer.ts
JUDGE_MAX_TOKENS = 1024  # aievals/judge.py
KEY_VAR = "ANTHROPIC_API_KEY_EVALS"
KEY_FILE = ROOT / ".env.live"
MAX_TRIES = 3  # per attempt; every try counts against the call budget
# The trainer's reason codes (functions/api/trainer.ts, and ai-evals/README.md).
REASON_CODE = re.compile(r"\(code: ([a-z-]+)\)")
TRANSIENT = frozenset({"rate", "upstream", "timeout", "unreachable"})  # worth a retry
ACCOUNT_FAILURES = frozenset({"credits", "key", "no-key"})  # nothing will answer: stop
CUT_OFF = "[The trainer was cut off."  # functions/api/trainer.ts CUT_OFF
NO_ANSWER = "The trainer didn't send an answer."  # its fallback when Claude sent nothing


@dataclass(frozen=True)
class Options:
    only: list[str]
    category: str | None
    reps: int
    max_trainer_calls: int
    max_judge_calls: int
    max_usd: float
    concurrency: int
    dry_run: bool
    port: int
    stub_port: int
    proxy_port: int


@dataclass(frozen=True)
class Attempt:
    case: Case
    rep: int
    raw: str | None  # the reply, or None when no reply could be scored
    error: str | None
    tries: int
    seconds: float


# -- setup -------------------------------------------------------------------------------


def load_key() -> str | None:
    """The live tier's Anthropic key: from the environment, else ai-evals/.env.live.

    Read as utf-8-sig: Notepad and PowerShell may save the file with a byte-order
    mark, which would otherwise hide the variable name on the first line.
    """
    if key := os.environ.get(KEY_VAR, "").strip():
        return key
    if KEY_FILE.exists():
        for line in KEY_FILE.read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == KEY_VAR and value.strip():
                return value.strip().strip("\"'")
    return None


def check_key(key: str) -> None:
    """Fail in a second, for free, if the key can't use both models (no tokens spent)."""
    client = anthropic.Anthropic(api_key=key, max_retries=1, timeout=20)
    try:
        for model in (TRAINER_MODEL, JUDGE_MODEL):
            client.models.retrieve(model)
    except anthropic.AuthenticationError:
        sys.exit(f"The Anthropic API rejected the key in {KEY_VAR}: check it, or create a new one.")
    except anthropic.NotFoundError:
        sys.exit(f"The key can't use {model}: check the workspace's model access.")
    except anthropic.APIError as e:
        sys.exit(f"Couldn't reach the Anthropic API to check the key ({type(e).__name__}).")


def select(dataset: Dataset, opts: Options) -> list[Case]:
    cases = dataset.cases
    if opts.only:
        unknown = set(opts.only) - {c.id for c in cases}
        if unknown:
            sys.exit(f"unknown case ids: {sorted(unknown)}")
        cases = [c for c in cases if c.id in opts.only]
    if opts.category:
        cases = [c for c in cases if c.category == opts.category]
    return cases


@contextmanager
def functions_server(opts: Options, upstream: str | None) -> Iterator[str]:
    """The Pages Functions, pointed at `upstream` (the proxy) or at the stub."""
    bash = shutil.which("bash")
    if bash is None:
        sys.exit("bash is required (Git Bash on Windows)")
    script = str(REPO / "api-tests" / "scripts" / "start-functions.sh")
    env = {
        **os.environ,
        "FUNCTIONS_PORT": str(opts.port),
        "STUB_PORT": str(opts.stub_port),
        "PYTHON": sys.executable,
    }
    if upstream:
        env["UPSTREAM_URL"] = upstream
    subprocess.run([bash, script, "--bg"], env=env, check=True, stdout=subprocess.DEVNULL)  # noqa: S603
    try:
        yield f"http://127.0.0.1:{opts.port}"
    finally:
        subprocess.run([bash, script, "--stop"], env=env, check=False, stdout=subprocess.DEVNULL)  # noqa: S603


def prepare(
    cases: Sequence[Case],
    dataset: Dataset,
    users: UserFactory,
    http: httpx.Client,
    settings: Settings,
    harness: ClientHarness,
) -> dict[str, tuple[SignedInUser, TrainerInput]]:
    """A seeded user for every case, and what the browser would post for them.

    Cases without hostile seeds share one user per persona; each seeded case gets
    its own, so its planted text reaches no other case.
    """

    def make(persona: str, seed: dict[Any, str]) -> SignedInUser:
        user = users.create(f"live-{persona}")
        api = RestClient(http, settings.supabase_url, settings.anon_key, user.access_token)
        seed_persona(api, user.id, with_seed(dataset.personas[persona], seed), date.today())
        return user

    make("jordan", {})  # another user's data must exist for isolation to mean anything
    shared: dict[str, SignedInUser] = {}
    owner: dict[str, SignedInUser] = {}
    for case in cases:
        if case.seed:
            owner[case.id] = make(case.persona, dict(case.seed))
        else:
            if case.persona not in shared:
                shared[case.persona] = make(case.persona, {})
            owner[case.id] = shared[case.persona]
    distinct = list({u.id: u for u in owner.values()}.values())
    inputs = dict(zip([u.id for u in distinct], harness.trainer_inputs(distinct), strict=True))
    return {cid: (user, inputs[user.id]) for cid, user in owner.items()}


def upper_bound_usd(
    cases: Sequence[Case], prepared: dict[str, tuple[SignedInUser, TrainerInput]], reps: int
) -> float:
    """The most the run could cost: every reply at its token ceiling, 3 characters a token."""
    rules_chars, chars_per_token = 6_000, 3  # the static rules, rounded up; English is ~4
    trainer = judge = 0.0
    for case in cases:
        given = prepared[case.id][1]
        prompt = rules_chars + len(given.context) + sum(map(len, given.memory)) + len(case.ask)
        prompt += sum(len(t.content) for t in case.history)
        trainer += cost_usd(TRAINER_MODEL, Usage(prompt // chars_per_token, TRAINER_MAX_TOKENS))
        for rubric in case.judge:
            judged = 2_500 + len(case.ask) + TRAINER_MAX_TOKENS * 4
            judged += len(given.context) if rubric in NEEDS_LOG else 0
            judge += cost_usd(JUDGE_MODEL, Usage(judged // chars_per_token, JUDGE_MAX_TOKENS))
    return (trainer + judge) * reps


# -- running -------------------------------------------------------------------------------


def ask(
    functions: FunctionsClient,
    case: Case,
    rep: int,
    user: SignedInUser,
    given: TrainerInput,
    stop: threading.Event,
) -> Attempt:
    """One (case, rep), retrying only failures that can pass on a second try.

    The trainer's reason codes say which those are. An account that can't answer
    at all (no credit, a rejected key) sets `stop`, so the rest of the run is
    skipped instead of spending its call budget on certain failures.
    """
    trainer = functions.as_user(user.access_token)
    history = [t.model_dump() for t in case.history]
    error, tries = "", 0
    while tries < MAX_TRIES and not stop.is_set():
        tries += 1
        start = time.monotonic()
        try:
            resp = trainer.ask_trainer(
                case.ask, history=history, context=given.context, memory=given.memory, timeout=120
            )
        except httpx.HTTPError as e:
            error = f"no response ({type(e).__name__})"
        else:
            if resp.status_code == 200 and not resp.text.startswith(NO_ANSWER):
                return Attempt(case, rep, resp.text, None, tries, time.monotonic() - start)
            error = f"HTTP {resp.status_code}: {resp.text[:160]}"
            code = m.group(1) if (m := REASON_CODE.search(resp.text)) else ""
            if code in ACCOUNT_FAILURES:
                stop.set()
            if code not in TRANSIENT:
                break
        if tries < MAX_TRIES:
            time.sleep(2**tries + random.uniform(0, 1))  # noqa: S311 (jitter, not crypto)
    return Attempt(case, rep, None, error or "skipped: the account can't answer", tries, 0.0)


def shown_to_judge(reply: ParsedReply) -> str:
    """What the user sees: the bubble, plus the memory chip when one is offered."""
    if reply.remember:
        return f'{reply.text}\n\n(The app also offers a "Remember" chip: "{reply.remember}")'
    return reply.text


def judge_all(
    grader: Grader,
    scored: Sequence[tuple[Attempt, ParsedReply, TrainerInput]],
    limit: int,
    concurrency: int,
    over_limit: str = "judge budget spent",
) -> list[list[JudgeResult]]:
    jobs = [(i, rubric) for i, (a, _, _) in enumerate(scored) for rubric in a.case.judge]
    results: list[list[JudgeResult]] = [[] for _ in scored]

    def grade(job: tuple[int, str]) -> JudgeResult:
        i, rubric = job
        attempt, reply, given = scored[i]
        return grader.grade(rubric, attempt.case.ask, shown_to_judge(reply), given.context)

    with ThreadPoolExecutor(concurrency) as pool:
        verdicts = list(pool.map(grade, jobs[:limit]))
    verdicts += [JudgeResult(r, None, over_limit) for _, r in jobs[limit:]]
    for (i, _), verdict in zip(jobs, verdicts, strict=True):
        results[i].append(verdict)
    return results


def run(opts: Options) -> int:
    settings = Settings.from_env()
    dataset = load_dataset()
    cases = select(dataset, opts)
    key = None if opts.dry_run else load_key()
    if not opts.dry_run and key is None:
        sys.exit(
            f"No Anthropic key. Put {KEY_VAR}=<key> in ai-evals/.env.live (gitignored) or the "
            "environment, or try the pipeline for free with --dry-run."
        )
    trainer_calls = len(cases) * opts.reps
    judge_calls = sum(len(c.judge) for c in cases) * opts.reps
    if trainer_calls > opts.max_trainer_calls or judge_calls > opts.max_judge_calls:
        print(
            f"Refusing to start: this run needs {trainer_calls} trainer calls "
            f"(limit {opts.max_trainer_calls}) and {judge_calls} judge calls "
            f"(limit {opts.max_judge_calls})."
        )
        return 2

    if key is not None:
        check_key(key)
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ("-dry" if opts.dry_run else "")
    out = REPORTS / run_id
    ClientHarness.build()
    harness = ClientHarness(settings.supabase_url, settings.anon_key)
    with httpx.Client(timeout=30) as http:
        users = UserFactory(
            AdminAuth(http, settings.supabase_url, settings.service_role_key),
            AuthClient(http, settings.supabase_url, settings.anon_key),
            f"live{secrets.token_hex(3)}",
        )
        try:
            prepared = prepare(cases, dataset, users, http, settings, harness)
            bound = 0.0 if opts.dry_run else upper_bound_usd(cases, prepared, opts.reps)
            if bound > opts.max_usd:
                print(
                    f"Refusing to start: this run could cost up to ${bound:.2f} "
                    f"(limit ${opts.max_usd:.2f})."
                )
                return 2
            print(
                f"Running {len(cases)} cases x {opts.reps}: {trainer_calls} trainer calls, "
                f"{judge_calls} judge calls, at most ${bound:.2f}.",
                flush=True,
            )
            attempts, calls, account_failed = _ask_everything(opts, key, http, cases, prepared)
        finally:
            users.delete_all()

    # Infrastructure failures, kept apart from model failures: never scored.
    errors = [
        {"case": a.case.id, "rep": a.rep, "error": a.error} for a in attempts if a.raw is None
    ]
    served = [c.model for c in calls if c.model]
    errors += [
        {"case": "*", "rep": 0, "error": f"answered by {m}, not {TRAINER_MODEL}"}
        for m in sorted(set(served))
        if not m.startswith(TRAINER_MODEL)
    ]
    ok = [a for a in attempts if a.raw is not None]
    replies = harness.parse([a.raw or "" for a in ok])
    rules = static_rules(next((c.system for c in calls if c.system), ""))
    secrets_map = {
        "Claude API key": key or FAKE_ANTHROPIC_KEY,
        "Supabase service-role key": settings.service_role_key,
        "Supabase JWT secret": settings.jwt_secret,
    }
    scored = [(a, r, prepared[a.case.id][1]) for a, r in zip(ok, replies, strict=True)]
    grader: Grader = (
        DryJudge() if opts.dry_run else Judge(anthropic.Anthropic(api_key=key, max_retries=3))
    )
    # If the account stopped answering, the judge (same account) can't either.
    verdicts = judge_all(
        grader,
        scored,
        0 if account_failed else opts.max_judge_calls,
        opts.concurrency,
        over_limit="skipped: the account can't answer" if account_failed else "judge budget spent",
    )
    runs = [
        Run(
            a.case,
            a.rep,
            r,
            run_rules(a.case.expect, r, prompt_rules=rules, secrets=secrets_map),
            v,
        )
        for (a, r, _), v in zip(scored, verdicts, strict=True)
    ]
    errors += [
        {"case": r.case.id, "rep": r.rep, "error": f"judge: {j.reason}"}
        for r in runs
        for j in r.judges
        if j.passed is None
    ]

    trainer_usage = sum((c.usage for c in calls), Usage())
    judge_usage = sum((j.usage for v in verdicts for j in v), Usage())
    cost = Cost(
        trainer_model=TRAINER_MODEL,
        trainer_usd=0.0 if opts.dry_run else cost_usd(TRAINER_MODEL, trainer_usage),
        trainer_calls=len(calls),
        judge_model=grader.model,
        judge_usd=0.0 if opts.dry_run else cost_usd(JUDGE_MODEL, judge_usage),
        judge_calls=sum(
            1 for v in verdicts for j in v if not j.reason.startswith(("judge budget", "skipped"))
        ),
    )
    outcomes = case_outcomes(cases, runs)
    summary = build_summary(
        run_id=run_id,
        timestamp=datetime.now(UTC).isoformat(timespec="seconds"),
        git_sha=_git_sha(),
        reps=opts.reps,
        dry_run=opts.dry_run,
        outcomes=outcomes,
        gates=category_gates(runs),
        errors=len(errors),
        served_models=served,
        cost=cost,
    )
    markdown = render_markdown(summary, outcomes)
    logs = {cid: given.context for cid, (_, given) in prepared.items()}
    _write(out, runs, errors, calls, rules, summary, markdown, logs)
    if not opts.dry_run:
        append_history(REPORTS / "history.json", summary)
    print(markdown)
    print(f"Results: {out}")
    if step_summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(step_summary, "a", encoding="utf-8") as f:
            f.write(markdown)
    if opts.dry_run:  # the stub's canned replies can't pass the cases; did the pipeline work?
        return 0 if not errors else 1
    return 0 if summary["gate"] == "pass" else 1


def _ask_everything(
    opts: Options,
    key: str | None,
    http: httpx.Client,
    cases: Sequence[Case],
    prepared: dict[str, tuple[SignedInUser, TrainerInput]],
) -> tuple[list[Attempt], list[ProxiedCall], bool]:
    """Every (case, rep) through the real function.

    Returns the attempts, the Claude calls, and whether the account stopped answering.
    """
    jobs = [(c, rep) for c in cases for rep in range(1, opts.reps + 1)]
    stop = threading.Event()  # set once the account can't answer at all

    def go(functions: FunctionsClient) -> list[Attempt]:
        with ThreadPoolExecutor(opts.concurrency) as pool:
            return list(
                pool.map(lambda j: ask(functions, j[0], j[1], *prepared[j[0].id], stop), jobs)
            )

    if opts.dry_run:
        with functions_server(opts, None) as url:
            attempts = go(FunctionsClient(http, url))
            stub = AnthropicStub(http, f"http://127.0.0.1:{opts.stub_port}")
            calls = [
                ProxiedCall(
                    str(c.body["messages"][-1]["content"]),
                    str(c.body.get("system", "")),
                    200,
                    model=str(c.body.get("model", "")),
                )
                for c in stub.calls()
            ]
        return attempts, calls, stop.is_set()
    assert key is not None
    with ClaudeProxy(key, opts.max_trainer_calls, port=opts.proxy_port) as proxy:
        with functions_server(opts, proxy.url) as url:
            attempts = go(FunctionsClient(http, url))
        return attempts, proxy.calls, stop.is_set()


def _git_sha() -> str:
    git = shutil.which("git")
    if git is None:
        return ""
    done = subprocess.run(  # noqa: S603 (fixed arguments)
        [git, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=False
    )
    return done.stdout.strip()


def _write(
    out: Path,
    runs: Sequence[Run],
    errors: Sequence[dict[str, Any]],
    calls: Sequence[ProxiedCall],
    rules: str,
    summary: dict[str, Any],
    markdown: str,
    logs: dict[str, str],
) -> None:
    """Full transcripts per (case, run), so any surprising score can be traced.

    `logs` (case id -> the synthetic persona's snapshot) is kept for rows a
    log-comparing rubric judged, so calibration can re-judge them exactly.
    """
    out.mkdir(parents=True, exist_ok=True)

    def jsonl(name: str, rows: Sequence[dict[str, Any]]) -> None:
        text = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        (out / name).write_text(text, encoding="utf-8")

    jsonl(
        "results.jsonl",
        [
            {
                "case": r.case.id,
                "category": r.case.category,
                "kind": r.case.kind,
                "rep": r.rep,
                "ask": r.case.ask,
                "reply": r.reply.raw,
                "shown": r.reply.text,
                "remember": r.reply.remember,
                "cut_off": CUT_OFF in r.reply.raw,
                "passed": r.passed,
                "rules": [asdict(c) for c in r.rules],
                "judges": [asdict(j) for j in r.judges],
                "log": logs[r.case.id] if NEEDS_LOG & set(r.case.judge) else None,
            }
            for r in runs
        ],
    )
    jsonl("errors.jsonl", errors)
    jsonl(
        "calls.jsonl",
        [
            {
                "question": c.question,
                "status": c.status,
                "model": c.model,
                "stop_reason": c.stop_reason,
                **asdict(c.usage),
            }
            for c in calls
        ],
    )
    (out / "prompt_rules.txt").write_text(rules, encoding="utf-8")
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    (out / "summary.md").write_text(markdown, encoding="utf-8")


def parse_args(argv: Sequence[str] | None = None) -> Options:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    p.add_argument("--only", nargs="*", default=[], help="case ids to run (default: all)")
    p.add_argument("--category", help="run one category only")
    p.add_argument("--reps", type=int, default=3, help="runs per case (default 3)")
    p.add_argument("--max-trainer-calls", type=int, default=200)
    p.add_argument("--max-judge-calls", type=int, default=100)
    p.add_argument("--max-usd", type=float, default=3.0, help="refuse runs that could cost more")
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument(
        "--dry-run", action="store_true", help="the stub instead of Claude; costs nothing"
    )
    p.add_argument("--port", type=int, default=8788, help="the functions server")
    p.add_argument("--stub-port", type=int, default=8790, help="the stub (dry runs)")
    p.add_argument("--proxy-port", type=int, default=8791, help="the proxy to Claude (live runs)")
    a = p.parse_args(argv)
    return Options(
        a.only,
        a.category,
        a.reps,
        a.max_trainer_calls,
        a.max_judge_calls,
        a.max_usd,
        a.concurrency,
        a.dry_run,
        a.port,
        a.stub_port,
        a.proxy_port,
    )


if __name__ == "__main__":
    price(TRAINER_MODEL)  # fail fast if the price list doesn't know the trainer's model
    sys.exit(run(parse_args()))
