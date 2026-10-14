"""Alerts for the production canary: what counts as a problem, and the GitHub issue it becomes.

Two kinds, kept apart because they need different people and different fixes:

- **infrastructure**: the deployed endpoint is failing or slow. The monitor
  account can't sign in, calls get no answer, or p95 latency is over budget.
- **quality**: the endpoint answers, but the answers fail the canary's checks,
  or the estimated cost per call has jumped (the replies changed shape).

One open issue per kind, labelled ``prod-ai-alert``: opened by the first failing
run, commented on while the problem persists (never a duplicate issue), and
closed with a comment by the first run that recovers. A run that scored nothing
(the endpoint was down) says nothing about quality, so it leaves a quality issue
exactly as it was.

Everything here is pure except `GitHubIssues`, a thin client over the REST API,
so the whole state machine is tested against a fake GitHub (tests/test_alerts.py).
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from statistics import median
from typing import Any, Literal

import httpx

Kind = Literal["infrastructure", "quality"]
KINDS: tuple[Kind, ...] = ("infrastructure", "quality")
Action = Literal["none", "opened", "commented", "closed", "unknown"]

LABEL = "prod-ai-alert"
LABEL_COLOR = "d93f0b"
LABEL_DESCRIPTION = "Opened and closed by the production AI canary (ai-evals/aievals/alerts.py)"

TITLES: dict[Kind, str] = {
    "infrastructure": "Production AI canary: the trainer endpoint is failing",
    "quality": "Production AI canary: trainer answers are below the quality bar",
}
WHAT_TO_CHECK: dict[Kind, str] = {
    "infrastructure": (
        "the reason code in each error (table in `ai-evals/README.md`), the function log "
        "(Cloudflare -> Pages -> fitlog-prod -> Functions -> logs), status.anthropic.com, "
        "and whether the latest production deploy finished."
    ),
    "quality": (
        "the failing cases' replies in the run's `results.jsonl` artifact, whether the "
        "deployed prompt or model changed (recent commits to `functions/api/trainer.ts`), "
        "and the live tier (the `AI evals (live)` workflow) for the full picture."
    ),
}
MARKER = re.compile(r"<!-- prod-ai-alert kind=(infrastructure|quality) -->")
# A run whose estimated cost per call is this many times the median of earlier runs.
COST_SPIKE_FACTOR = 2.0
COST_SPIKE_MIN_HISTORY = 3


@dataclass(frozen=True)
class Finding:
    """One reason an alert fires: a headline and the lines under it."""

    kind: Kind
    headline: str
    details: list[str] = field(default_factory=list)


Findings = dict[Kind, list[Finding] | None]  # None: this run can't say (nothing scored)


# -- what is a problem -------------------------------------------------------------------


def evaluate(summary: Mapping[str, Any], history: Sequence[Mapping[str, Any]]) -> Findings:
    """The findings of one canary run, per kind, given the earlier runs for baselines."""
    infra: list[Finding] = []
    i = summary["infrastructure"]
    if i["sign_in"] != "ok":
        infra.append(
            Finding("infrastructure", f"the monitor account could not sign in ({i['sign_in']})")
        )
    if i["errors"]:
        infra.append(
            Finding(
                "infrastructure",
                f"{len(i['errors'])} of {summary['attempts']} calls got no answer",
                [f"`{e['case']}`: {e['error']}" for e in i["errors"]],
            )
        )
    latency = summary.get("latency")
    if latency and latency.get("ok") is False:
        infra.append(
            Finding(
                "infrastructure",
                f"p95 latency {latency['p95_ms']:,} ms is over the "
                f"{latency['budget_p95_ms']:,} ms budget",
                [
                    f"p50 {latency['p50_ms']:,} ms, max {latency['max_ms']:,} ms "
                    f"over {latency['samples']} answers"
                ],
            )
        )

    quality: list[Finding] | None
    if summary["scored"] == 0:
        quality = None
    else:
        quality = []
        failed = summary["quality"]["failed"]
        if failed:
            quality.append(
                Finding(
                    "quality",
                    f"{len(failed)} of {summary['cases']} cases failed",
                    [f"`{f['id']}` ({f['title']}): {f['detail']}" for f in failed],
                )
            )
        if spike := cost_spike(summary, history):
            quality.append(spike)
    return {"infrastructure": infra, "quality": quality}


def _per_call(run: Mapping[str, Any]) -> float | None:
    cost = run.get("cost") or {}
    calls = cost.get("trainer_calls") or 0
    return float(cost["trainer_usd"]) / calls if calls else None


def cost_spike(summary: Mapping[str, Any], history: Sequence[Mapping[str, Any]]) -> Finding | None:
    """Estimated cost per call far above the median of earlier real runs.

    The prompt is fixed, so per-call cost only moves with reply length: a spike
    means the replies changed shape (a prompt or model change), which is a
    quality signal, not a billing one.
    """
    mine = _per_call(summary)
    if mine is None:
        return None
    earlier = [
        c
        for r in history
        if r.get("run_id") != summary["run_id"] and not r.get("drill")
        if (c := _per_call(r)) is not None
    ]
    if len(earlier) < COST_SPIKE_MIN_HISTORY:
        return None
    baseline = median(earlier)
    if baseline <= 0 or mine <= baseline * COST_SPIKE_FACTOR:
        return None
    return Finding(
        "quality",
        f"estimated cost per call ${mine:.4f} is more than {COST_SPIKE_FACTOR:g}x the median "
        f"of the last {len(earlier)} runs (${baseline:.4f})",
        [
            "Replies are much longer than usual, or the prompt grew: check recent changes "
            "to `functions/api/trainer.ts`."
        ],
    )


# -- the issue text ------------------------------------------------------------------------


def _run_line(summary: Mapping[str, Any]) -> str:
    run = f"Canary run `{summary['run_id']}` against {summary['site']} at {summary['timestamp']}"
    if summary.get("run_url"):
        run += f" ([workflow run]({summary['run_url']}))"
    return run + "."


def _bullets(findings: Sequence[Finding]) -> str:
    lines = []
    for f in findings:
        lines.append(f"- {f.headline}")
        lines += [f"  - {d}" for d in f.details]
    return "\n".join(lines)


def _drill_note(summary: Mapping[str, Any]) -> str:
    if not summary.get("drill"):
        return ""
    return (
        f"\n\n**This is a drill** (`--drill {summary['drill']}`): the run was broken on purpose "
        "to prove the alerting works. The next real run closes this issue."
    )


def title(kind: Kind, summary: Mapping[str, Any]) -> str:
    return ("[DRILL] " if summary.get("drill") else "") + TITLES[kind]


def opened_body(kind: Kind, findings: Sequence[Finding], summary: Mapping[str, Any]) -> str:
    lead = {
        "infrastructure": "**The production trainer endpoint is failing.**",
        "quality": "**Production trainer answers are below the quality bar.**",
    }[kind]
    return (
        f"<!-- prod-ai-alert kind={kind} -->\n{lead}\n\n{_run_line(summary)}\n\n"
        f"{_bullets(findings)}\n\n**What to check:** {WHAT_TO_CHECK[kind]}"
        f"{_drill_note(summary)}\n\n"
        "Opened by the production canary workflow. It comments here while the problem "
        "persists and closes this issue itself when a run recovers."
    )


def still_failing_body(findings: Sequence[Finding], summary: Mapping[str, Any]) -> str:
    return f"Still failing. {_run_line(summary)}\n\n{_bullets(findings)}{_drill_note(summary)}"


def recovered_body(summary: Mapping[str, Any]) -> str:
    latency = summary.get("latency") or {}
    p95 = f", p95 latency {latency['p95_ms']:,} ms" if latency.get("p95_ms") is not None else ""
    return (
        f"Recovered. {_run_line(summary)} {summary['quality']['passed']} of "
        f"{summary['scored']} scored cases passed, {len(summary['infrastructure']['errors'])} "
        f"calls without an answer{p95}. Closing."
    )


def kind_of(issue: Mapping[str, Any]) -> Kind | None:
    """Which kind an issue tracks, from the marker its body carries."""
    m = MARKER.search(issue.get("body") or "")
    if m is None:
        return None
    return "infrastructure" if m.group(1) == "infrastructure" else "quality"


# -- GitHub ----------------------------------------------------------------------------------


class GitHubIssues:
    """The handful of REST calls the alerts need, on one repository.

    `http` carries the base URL and the token; this class never sees the token.
    """

    def __init__(self, http: httpx.Client, repo: str) -> None:
        self._http = http
        self._repo = repo

    def _url(self, path: str) -> str:
        return f"/repos/{self._repo}/{path}"

    @staticmethod
    def _ok(resp: httpx.Response) -> dict[str, Any]:
        resp.raise_for_status()
        data: dict[str, Any] = resp.json() if resp.content else {}
        return data

    def open_alerts(self) -> list[dict[str, Any]]:
        """Open issues carrying the alert label, oldest first (pull requests excluded)."""
        resp = self._http.get(
            self._url("issues"),
            params={
                "labels": LABEL,
                "state": "open",
                "per_page": 50,
                "sort": "created",
                "direction": "asc",
            },
        )
        resp.raise_for_status()
        issues: list[dict[str, Any]] = resp.json()
        return [i for i in issues if "pull_request" not in i]

    def ensure_label(self) -> None:
        resp = self._http.get(self._url(f"labels/{LABEL}"))
        if resp.status_code == 404:
            self._ok(
                self._http.post(
                    self._url("labels"),
                    json={"name": LABEL, "color": LABEL_COLOR, "description": LABEL_DESCRIPTION},
                )
            )
        else:
            resp.raise_for_status()

    def create(self, issue_title: str, body: str) -> dict[str, Any]:
        return self._ok(
            self._http.post(
                self._url("issues"), json={"title": issue_title, "body": body, "labels": [LABEL]}
            )
        )

    def comment(self, number: int, body: str) -> None:
        self._ok(self._http.post(self._url(f"issues/{number}/comments"), json={"body": body}))

    def close(self, number: int) -> None:
        self._ok(
            self._http.patch(
                self._url(f"issues/{number}"),
                json={"state": "closed", "state_reason": "completed"},
            )
        )


def github_client(token: str, api_url: str = "https://api.github.com") -> httpx.Client:
    return httpx.Client(
        base_url=api_url,
        headers={
            "authorization": f"Bearer {token}",
            "accept": "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
        },
        timeout=30,
    )


# -- the state machine ----------------------------------------------------------------------


def reconcile(
    issues: GitHubIssues, findings: Findings, summary: Mapping[str, Any]
) -> dict[Kind, dict[str, Any]]:
    """Open, comment on or close the alert issue of each kind to match this run.

    Returns, per kind, the action taken and the issue number it concerns.
    """
    open_by_kind: dict[Kind, dict[str, Any]] = {}
    for issue in issues.open_alerts():
        kind = kind_of(issue)
        if kind is not None and kind not in open_by_kind:  # the oldest open one per kind
            open_by_kind[kind] = issue

    result: dict[Kind, dict[str, Any]] = {}
    for kind in KINDS:
        found = findings[kind]
        current = open_by_kind.get(kind)
        number: int | None = current["number"] if current else None
        action: Action
        if found is None:
            action = "unknown"
        elif found:
            if number is not None:
                issues.comment(number, still_failing_body(found, summary))
                action = "commented"
            else:
                issues.ensure_label()
                created = issues.create(title(kind, summary), opened_body(kind, found, summary))
                number = int(created["number"])
                action = "opened"
        elif number is not None:
            issues.comment(number, recovered_body(summary))
            issues.close(number)
            action = "closed"
        else:
            action = "none"
        result[kind] = {"action": action, "issue": number}
    return result


def describe(findings: Findings, result: Mapping[Kind, Mapping[str, Any]] | None) -> str:
    """One line per kind, for the console and the job summary."""
    lines = []
    for kind in KINDS:
        found = findings[kind]
        state = (
            "could not be assessed (nothing was scored)"
            if found is None
            else "ok"
            if not found
            else "; ".join(f.headline for f in found)
        )
        action = ""
        if result is not None:
            r = result[kind]
            action = f" -> {r['action']}" + (f" #{r['issue']}" if r.get("issue") else "")
        lines.append(f"{kind}: {state}{action}")
    return "\n".join(lines)
