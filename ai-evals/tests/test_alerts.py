"""The production canary's alerting, proven against a fake GitHub before it touches the real one.

A monitor that opens a duplicate issue every six hours, or never closes one,
trains people to ignore it. So the state machine (open once, comment while it
lasts, close on recovery, infrastructure and quality apart) runs here against an
in-memory issues API, on summaries whose verdict is known.
"""

import json
from typing import Any

import httpx
import pytest

from aievals import alerts
from aievals.alerts import LABEL, Finding, GitHubIssues, evaluate, kind_of, reconcile


class FakeGitHub:
    """Just enough of the issues API, in memory, recording every write."""

    def __init__(self, *, label_exists: bool = True) -> None:
        self.issues: list[dict[str, Any]] = []
        self.comments: dict[int, list[str]] = {}
        self.labels = {LABEL} if label_exists else set()
        self.writes: list[str] = []

    def add_open(self, kind: str, title: str = "existing") -> dict[str, Any]:
        issue = {
            "number": len(self.issues) + 1,
            "title": title,
            "body": f"<!-- prod-ai-alert kind={kind} -->\nopened earlier",
            "labels": [{"name": LABEL}],
            "state": "open",
        }
        self.issues.append(issue)
        return issue

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        body = json.loads(request.content) if request.content else {}
        if method != "GET":
            self.writes.append(f"{method} {path}")
        if method == "GET" and path.endswith("/issues"):
            state = request.url.params.get("state")
            wanted = request.url.params.get("labels")
            found = [
                i
                for i in self.issues
                if i["state"] == state and any(lb["name"] == wanted for lb in i["labels"])
            ]
            return httpx.Response(200, json=found)
        if method == "GET" and "/labels/" in path:
            exists = path.rsplit("/", 1)[1] in self.labels
            return httpx.Response(200 if exists else 404, json={})
        if method == "POST" and path.endswith("/labels"):
            self.labels.add(body["name"])
            return httpx.Response(201, json=body)
        if method == "POST" and path.endswith("/issues"):
            issue = {
                "number": len(self.issues) + 1,
                "title": body["title"],
                "body": body["body"],
                "labels": [{"name": n} for n in body.get("labels", [])],
                "state": "open",
            }
            self.issues.append(issue)
            return httpx.Response(201, json=issue)
        if method == "POST" and path.endswith("/comments"):
            number = int(path.split("/")[-2])
            self.comments.setdefault(number, []).append(body["body"])
            return httpx.Response(201, json={"id": len(self.comments[number])})
        if method == "PATCH" and "/issues/" in path:
            issue = self.issues[int(path.rsplit("/", 1)[1]) - 1]
            issue.update({k: v for k, v in body.items() if k in ("state", "state_reason")})
            return httpx.Response(200, json=issue)
        return httpx.Response(404, json={"message": f"no route for {method} {path}"})

    def api(self) -> GitHubIssues:
        http = httpx.Client(
            base_url="https://api.github.test", transport=httpx.MockTransport(self.handler)
        )
        return GitHubIssues(http, "owner/fitlog")


def summary(**overrides: Any) -> dict[str, Any]:  # noqa: ANN401 (free-form test data)
    """A passing canary run; overrides make it fail in one specific way."""
    base: dict[str, Any] = {
        "run_id": "20261014T120000Z",
        "timestamp": "2026-10-14T12:00:30+00:00",
        "site": "https://fitlog-prod.pages.dev",
        "drill": None,
        "cases": 10,
        "scored": 10,
        "attempts": 10,
        "status": "pass",
        "infrastructure": {"ok": True, "sign_in": "ok", "errors": []},
        "quality": {"ok": True, "passed": 10, "failed": [], "inconsistent": [], "judge_errors": 0},
        "latency": {
            "samples": 10,
            "p50_ms": 2100,
            "p95_ms": 4300,
            "max_ms": 4300,
            "budget_p95_ms": 12000,
            "ok": True,
        },
        "cost": {"estimated": True, "trainer_usd": 0.05, "trainer_calls": 10},
        "run_url": "https://github.com/owner/fitlog/actions/runs/1",
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


def endpoint_down() -> dict[str, Any]:
    errors = [
        {"case": f"c{i}", "error": "HTTP 502: unavailable (code: unreachable)"} for i in range(10)
    ]
    return summary(
        status="fail",
        scored=0,
        infrastructure={"ok": False, "errors": errors},
        quality={"ok": None, "passed": 0},
        latency=None,
    )


def answers_wrong() -> dict[str, Any]:
    return summary(
        status="fail",
        quality={
            "ok": False,
            "passed": 9,
            "failed": [
                {
                    "id": "q-math-calories-left",
                    "title": "calories left = 2,400 - 1,735 = 665",
                    "detail": "numbers_include: missing [665.0]",
                }
            ],
        },
    )


# -- what counts as a problem ---------------------------------------------------------------


def test_a_passing_run_has_no_findings_and_can_speak_to_quality() -> None:
    assert evaluate(summary(), []) == {"infrastructure": [], "quality": []}


def test_a_down_endpoint_is_infrastructure_and_says_nothing_about_quality() -> None:
    findings = evaluate(endpoint_down(), [])

    assert [f.headline for f in findings["infrastructure"] or []] == [
        "10 of 10 calls got no answer"
    ]
    assert findings["quality"] is None


def test_a_failed_sign_in_and_slow_answers_are_infrastructure() -> None:
    slow = summary(
        infrastructure={"ok": False, "sign_in": "failed: HTTP 400 (Invalid login credentials)"},
        latency={"p95_ms": 14200, "max_ms": 14200, "ok": False},
    )

    headlines = [f.headline for f in evaluate(slow, [])["infrastructure"] or []]

    assert headlines == [
        "the monitor account could not sign in (failed: HTTP 400 (Invalid login credentials))",
        "p95 latency 14,200 ms is over the 12,000 ms budget",
    ]


def test_wrong_answers_are_quality_with_the_failed_check_named() -> None:
    findings = evaluate(answers_wrong(), [])

    assert findings["infrastructure"] == []
    (finding,) = findings["quality"] or []
    assert finding.headline == "1 of 10 cases failed"
    assert finding.details == [
        "`q-math-calories-left` (calories left = 2,400 - 1,735 = 665): "
        "numbers_include: missing [665.0]"
    ]


def test_a_cost_spike_needs_a_baseline_and_ignores_drills() -> None:
    pricey = summary(cost={"trainer_usd": 0.30, "trainer_calls": 10})  # $0.03 a call
    normal = [
        summary(run_id=f"r{i}", cost={"trainer_usd": 0.05, "trainer_calls": 10}) for i in range(3)
    ]
    drills = [
        summary(run_id=f"d{i}", drill="quality", cost={"trainer_usd": 0.05, "trainer_calls": 3})
        for i in range(3)
    ]

    assert evaluate(pricey, normal[:2])["quality"] == [], "two earlier runs are not a baseline"
    assert evaluate(pricey, drills)["quality"] == [], "drills are not a baseline"
    (spike,) = evaluate(pricey, normal)["quality"] or []
    assert spike.headline.startswith("estimated cost per call $0.0300 is more than 2x the median")
    assert (
        evaluate(summary(cost={"trainer_usd": 0.09, "trainer_calls": 10}), normal)["quality"] == []
    )


# -- the issue state machine --------------------------------------------------------------


def test_a_failing_run_opens_one_issue_per_kind_with_the_label() -> None:
    gh = FakeGitHub(label_exists=False)
    both = answers_wrong()
    both["infrastructure"] = {
        "ok": False,
        "sign_in": "ok",
        "errors": [{"case": "c1", "error": "HTTP 504: (code: timeout)"}],
    }

    result = reconcile(gh.api(), evaluate(both, []), both)

    assert result == {
        "infrastructure": {"action": "opened", "issue": 1},
        "quality": {"action": "opened", "issue": 2},
    }
    assert LABEL in gh.labels, "a missing label is created, never assumed"
    titles = [i["title"] for i in gh.issues]
    assert titles == [
        "Production AI canary: the trainer endpoint is failing",
        "Production AI canary: trainer answers are below the quality bar",
    ]
    assert all(i["labels"] == [{"name": LABEL}] for i in gh.issues)
    assert {kind_of(i) for i in gh.issues} == {"infrastructure", "quality"}
    quality_body = gh.issues[1]["body"]
    assert "`q-math-calories-left`" in quality_body
    assert "actions/runs/1" in quality_body, "the body links the workflow run"
    assert "What to check" in quality_body


def test_a_still_failing_run_comments_on_the_open_issue_instead_of_opening_another() -> None:
    gh = FakeGitHub()
    existing = gh.add_open("quality")

    result = reconcile(gh.api(), evaluate(answers_wrong(), []), answers_wrong())

    assert result["quality"] == {"action": "commented", "issue": existing["number"]}
    assert len(gh.issues) == 1, "no duplicate"
    (comment,) = gh.comments[existing["number"]]
    assert comment.startswith("Still failing.")
    assert "`q-math-calories-left`" in comment


def test_a_recovered_run_comments_and_closes_the_open_issue() -> None:
    gh = FakeGitHub()
    existing = gh.add_open("infrastructure")

    result = reconcile(gh.api(), evaluate(summary(), []), summary())

    assert result == {
        "infrastructure": {"action": "closed", "issue": existing["number"]},
        "quality": {"action": "none", "issue": None},
    }
    assert gh.issues[0]["state"] == "closed"
    assert gh.issues[0]["state_reason"] == "completed"
    (comment,) = gh.comments[existing["number"]]
    assert comment.startswith("Recovered.")
    assert "10 of 10 scored cases passed" in comment
    assert gh.writes == [
        f"POST /repos/owner/fitlog/issues/{existing['number']}/comments",
        f"PATCH /repos/owner/fitlog/issues/{existing['number']}",
    ]


def test_infrastructure_and_quality_are_tracked_apart() -> None:
    """The endpoint recovers while the answers are still wrong: one closes, one goes on."""
    gh = FakeGitHub()
    infra, quality = gh.add_open("infrastructure"), gh.add_open("quality")

    result = reconcile(gh.api(), evaluate(answers_wrong(), []), answers_wrong())

    assert result == {
        "infrastructure": {"action": "closed", "issue": infra["number"]},
        "quality": {"action": "commented", "issue": quality["number"]},
    }
    assert [i["state"] for i in gh.issues] == ["closed", "open"]


def test_a_down_endpoint_leaves_an_open_quality_issue_exactly_as_it_was() -> None:
    gh = FakeGitHub()
    quality = gh.add_open("quality")

    result = reconcile(gh.api(), evaluate(endpoint_down(), []), endpoint_down())

    assert result["quality"] == {"action": "unknown", "issue": quality["number"]}
    assert result["infrastructure"]["action"] == "opened"
    assert quality["state"] == "open"
    assert quality["number"] not in gh.comments, "nothing to say about quality: no comment"


def test_a_labelled_issue_a_person_opened_is_left_alone() -> None:
    gh = FakeGitHub()
    gh.issues.append(
        {
            "number": 1,
            "title": "I think the trainer is odd",
            "body": "no marker here",
            "labels": [{"name": LABEL}],
            "state": "open",
        }
    )

    reconcile(gh.api(), evaluate(summary(), []), summary())

    assert gh.writes == []
    assert gh.issues[0]["state"] == "open"


def test_a_drill_says_so_in_the_title_and_the_body() -> None:
    gh = FakeGitHub()
    drill = endpoint_down()
    drill["drill"] = "infrastructure"

    reconcile(gh.api(), evaluate(drill, []), drill)

    assert gh.issues[0]["title"].startswith("[DRILL] ")
    assert "This is a drill" in gh.issues[0]["body"]


def test_a_refusal_from_github_is_an_error_not_a_silent_skip() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "Resource not accessible by integration"})

    http = httpx.Client(base_url="https://api.github.test", transport=httpx.MockTransport(refuse))

    with pytest.raises(httpx.HTTPStatusError):
        reconcile(
            GitHubIssues(http, "owner/fitlog"), evaluate(answers_wrong(), []), answers_wrong()
        )


def test_describe_reads_as_one_line_per_kind() -> None:
    findings: alerts.Findings = {
        "infrastructure": [Finding("infrastructure", "3 of 10 calls got no answer")],
        "quality": None,
    }
    result: dict[alerts.Kind, dict[str, Any]] = {
        "infrastructure": {"action": "opened", "issue": 7},
        "quality": {"action": "unknown", "issue": None},
    }

    assert alerts.describe(findings, result).splitlines() == [
        "infrastructure: 3 of 10 calls got no answer -> opened #7",
        "quality: could not be assessed (nothing was scored) -> unknown",
    ]
