"""Ground truth for the grounding evals: what a persona's seeded rows say, worked out here.

This is an independent re-implementation of the numbers src/lib/trainerContext.ts
puts in front of the trainer, written from the rows the persona seeds (never by
calling the app's code), so it can catch the snapshot getting them wrong. Each
fact is marked `visible` (the snapshot states it, so the model may quote it) or
not (it is only in the database: a single day's total, a meal, a food name).

Tier 1 checks the snapshot against the visible facts, both ways: every fact is
stated correctly, and every number the snapshot holds is one of them. Tier 2's
fact checker (aievals/factcheck.py) then judges replies against the same facts.

Covers what the grounding persona logs: profile, goal, weigh-ins, workouts,
cardio, meals, supplements. Injuries, pain and strength goals are out of scope.
"""

import ast
import math
import operator
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from aievals.dataset import Persona

# Windows in src/lib/trainerContext.ts.
LIFT_WINDOW_DAYS = 90
RECENT_LIFT_DAYS = 14
CARDIO_WINDOW_DAYS = 14
NUTRITION_WINDOW_DAYS = 28
RECENT_NUTRITION_DAYS = 7
WEIGHT_WINDOW_DAYS = 120
MIN_DAYS_FOR_MICROS = 5
# src/lib/calc.ts
KCAL_PER_LB = 3500
ADAPTIVE_MIN_SPAN_DAYS = 14
ADAPTIVE_MIN_LOGGED_DAYS = 10
ADAPTIVE_MIN_DAY_KCAL = 500
# src/lib/nutrients.ts: (key, label, daily value), in the order the snapshot lists them.
MICROS = (
    ("fiber", "Fiber", 28),
    ("iron", "Iron", 18),
    ("calcium", "Calcium", 1300),
    ("vit_d", "Vitamin D", 20),
    ("potassium", "Potassium", 4700),
    ("magnesium", "Magnesium", 420),
    ("zinc", "Zinc", 11),
    ("b12", "Vitamin B12", 2.4),
)
MEALS = ("breakfast", "lunch", "dinner", "snacks")


def js_round(x: float) -> int:
    """JavaScript's Math.round: halves go up (Python's round() goes to even)."""
    return math.floor(x + 0.5)


def to_fixed(x: float, digits: int) -> float:
    """The value Number.toFixed(digits) shows, as a number."""
    return float(f"{x:.{digits}f}")


@dataclass(frozen=True)
class Fact:
    name: str
    value: float
    unit: str  # kcal, g, lb, lb/week, g/lb, %, days, count, min, reps, y, cm
    visible: bool = True  # stated in the snapshot; False = only in the database
    day: str | None = None  # a single day's figure: its ISO date
    # What the figure is about, so "you're averaging 1,800" can't be backed by a
    # goal of 1,800: intake, target, maintenance, bodyweight, lift, or None (any).
    topic: str | None = None


@dataclass(frozen=True)
class Meal:
    """One meal on one day, from the database (never in the snapshot)."""

    day: str
    meal: str
    foods: tuple[str, ...]
    kcal: float
    protein: float


@dataclass
class Facts:
    today: str
    facts: dict[str, Fact] = field(default_factory=dict)
    dates: set[str] = field(default_factory=set)  # every date the snapshot states
    names: set[str] = field(default_factory=set)  # every name the snapshot states
    meals: list[Meal] = field(default_factory=list)  # database only
    foods: set[str] = field(default_factory=set)  # every food logged (database only)

    def add(self, fact: Fact) -> None:
        if fact.topic is None:
            fact = replace(fact, topic=_topic(fact.name))
        self.facts[fact.name] = fact

    def __getitem__(self, name: str) -> float:
        return self.facts[name].value

    def visible(self) -> list[Fact]:
        return [f for f in self.facts.values() if f.visible]

    def eval(self, expr: str) -> float:
        """An arithmetic expression over fact names: "goal_kcal - avg28_kcal"."""
        return _Evaluator(self).run(expr)


def _topic(name: str) -> str | None:
    if name.startswith(("avg28_", "avg7_", "day_", "logged", "protein_g_per_lb")):
        return "intake"
    if name in ("goal_kcal", "goal_rate_lb_week") or name.endswith("_target_g"):
        return "target"
    if name == "tdee_kcal":
        return "maintenance"
    if name.startswith(("weight", "weighin_", "trend_")):
        return "bodyweight"
    if " " in name:  # "<lift> best est 1RM", "<lift> <date> weight"
        return "lift"
    return None


# -- the snapshot's numbers ------------------------------------------------------------


def ground_truth(persona: Persona, today: date) -> Facts:
    t = today.isoformat()
    out = Facts(today=t)
    out.dates.add(t)

    def day(days_ago: int) -> str:
        return (today - timedelta(days=days_ago)).isoformat()

    def ago(iso: str) -> int:
        return (today - date.fromisoformat(iso)).days

    p = persona.profile
    age = math.floor(((today - date(today.year - p.age, 1, 1)).days) / 365.25)
    out.add(Fact("age", age, "y"))
    out.add(Fact("height_cm", js_round(p.height_cm), "cm"))

    # -- weigh-ins: the latest, and one change line --
    weights = sorted(
        ((day(w.days_ago), w.lb) for w in persona.weights if w.days_ago <= WEIGHT_WINDOW_DAYS),
        reverse=True,
    )
    latest = weights[0][1] if weights else None
    if latest is not None:
        out.add(Fact("weight_lb", js_round(latest), "lb"))
        out.add(Fact("weight_exact_lb", latest, "lb", visible=False))
    if len(weights) >= 3:
        (newest_day, newest), (oldest_day, oldest) = weights[0], weights[-1]
        span = ago(oldest_day) - ago(newest_day)
        if span >= 7:
            delta = newest - oldest
            out.add(Fact("weight_delta_lb", to_fixed(abs(delta), 1), "lb"))
            out.add(Fact("weight_span_days", span, "days"))
            out.add(Fact("weight_direction", 1 if delta >= 0 else -1, "sign"))
    for d, lb in weights:
        out.add(Fact(f"weighin_{d}", lb, "lb", visible=False, day=d))

    _lifting(persona, out, day, ago)
    _cardio(persona, out, day)
    _nutrition(persona, out, day, latest, weights)

    out.names |= set(persona.supplements) | set(persona.routines)
    if persona.supplements:
        out.add(Fact("supplements", len(persona.supplements), "count", visible=False))
    return out


def _lifting(
    persona: Persona, out: Facts, day: Callable[[int], str], ago: Callable[[str], int]
) -> None:
    workouts = sorted(
        (w for w in persona.workouts if w.days_ago <= LIFT_WINDOW_DAYS), key=lambda w: w.days_ago
    )
    if not workouts:
        return
    out.add(Fact("lift_sessions_90", len(workouts), "count"))
    out.add(Fact("lift_window_days", LIFT_WINDOW_DAYS, "days"))
    out.add(
        Fact("lift_sessions_14", sum(w.days_ago <= RECENT_LIFT_DAYS for w in workouts), "count")
    )
    out.add(Fact("recent_lift_window_days", RECENT_LIFT_DAYS, "days"))
    out.dates.add(day(workouts[0].days_ago))
    out.names |= {w.name for w in workouts}
    by_lift: dict[str, list[tuple[int, float, int]]] = {}  # name -> (days_ago, lb, reps)
    for w in workouts:
        for s in w.sets:
            by_lift.setdefault(s.name, []).extend([(w.days_ago, s.lb, s.reps)] * s.sets)
    ranked = sorted(by_lift.items(), key=lambda kv: -len(kv[1]))[:8]
    for name, sets in ranked:
        out.names.add(name)
        best = max(
            (lb if reps == 1 else lb * (1 + reps / 30)) for _, lb, reps in sets if lb > 0 and reps
        )
        out.add(Fact(f"{name} best est 1RM", js_round(best), "lb"))
        for days_ago in sorted({d for d, _, _ in sets})[:4]:
            out.dates.add(day(days_ago))
            for _, lb, reps in (s for s in sets if s[0] == days_ago):
                out.add(
                    Fact(f"{name} {day(days_ago)} weight", js_round(lb), "lb", day=day(days_ago))
                )
                out.add(Fact(f"{name} {day(days_ago)} reps", reps, "reps", day=day(days_ago)))


def _cardio(persona: Persona, out: Facts, day: Callable[[int], str]) -> None:
    recent = [c for c in persona.cardio if c.days_ago <= CARDIO_WINDOW_DAYS]
    if not recent:
        return
    out.add(Fact("cardio_sessions", len(recent), "count"))
    out.add(Fact("cardio_min", js_round(sum(c.minutes for c in recent)), "min"))
    out.add(Fact("cardio_window_days", CARDIO_WINDOW_DAYS, "days"))
    out.names |= {c.name for c in recent}


def _nutrition(
    persona: Persona,
    out: Facts,
    day: Callable[[int], str],
    latest: float | None,
    weights: list[tuple[str, float]],
) -> None:
    p = persona.profile
    goal = p.calorie_goal
    out.add(Fact("goal_kcal", goal, "kcal"))
    if p.goal_type != "maintain":
        out.add(Fact("goal_rate_lb_week", p.goal_rate_lb_per_week, "lb/week"))
    if latest is not None:
        # protein in grams, fat 25% of the goal, carbs the remainder (personas.py).
        protein = p.protein_g
        fat = 0.25 * goal / 9
        carb = max(0, goal - protein * 4 - fat * 9) / 4
        out.add(Fact("protein_target_g", js_round(protein), "g"))
        out.add(Fact("carb_target_g", js_round(carb), "g"))
        out.add(Fact("fat_target_g", js_round(fat), "g"))

    # Per-day totals: per-serving nutrients x servings, summed.
    totals: dict[str, dict[str, float]] = {}
    meals: dict[tuple[str, str], list[tuple[str, dict[str, float]]]] = {}
    for f in persona.food_log:
        if f.days_ago < 0:
            continue
        d = day(f.days_ago)
        scaled = {k: v * f.servings for k, v in persona.foods[f.food].nutrients().items()}
        day_total = totals.setdefault(d, {})
        for k, v in scaled.items():
            day_total[k] = day_total.get(k, 0) + v
        meals.setdefault((d, f.meal), []).append((f.food, scaled))
        out.foods.add(f.food)
    for (d, meal), rows in sorted(meals.items()):
        out.meals.append(
            Meal(
                d,
                meal,
                tuple(food for food, _ in rows),
                sum(n.get("kcal", 0) for _, n in rows),
                sum(n.get("protein", 0) for _, n in rows),
            )
        )
    for d, n in totals.items():
        out.add(Fact(f"day_kcal_{d}", js_round(n.get("kcal", 0)), "kcal", visible=False, day=d))
        out.add(Fact(f"day_protein_{d}", js_round(n.get("protein", 0)), "g", visible=False, day=d))

    # "The last N days" = today and the N-1 days before it.
    def window(n: int) -> list[tuple[str, dict[str, float]]]:
        since = day(n - 1)
        return sorted((d, t) for d, t in totals.items() if d >= since and t.get("kcal", 0) > 0)

    days = window(NUTRITION_WINDOW_DAYS)
    out.add(Fact("nutrition_window_days", NUTRITION_WINDOW_DAYS, "days"))
    if not days:
        return

    def avg(rows: list[tuple[str, dict[str, float]]], key: str) -> float:
        return sum(t.get(key, 0) for _, t in rows) / len(rows)

    out.add(Fact("logged28", len(days), "days"))
    out.add(Fact("avg28_kcal", js_round(avg(days, "kcal")), "kcal"))
    out.add(Fact("avg28_protein", js_round(avg(days, "protein")), "g"))
    out.add(Fact("avg28_carb", js_round(avg(days, "carb")), "g"))
    out.add(Fact("avg28_fat", js_round(avg(days, "fat")), "g"))
    if latest is not None:
        out.add(Fact("protein_g_per_lb", to_fixed(avg(days, "protein") / latest, 2), "g/lb"))
    recent = window(RECENT_NUTRITION_DAYS)
    out.add(Fact("recent_window_days", RECENT_NUTRITION_DAYS, "days"))
    if len(recent) >= 2:
        out.add(Fact("logged7", len(recent), "days"))
        out.add(Fact("avg7_kcal", js_round(avg(recent, "kcal")), "kcal"))
        out.add(Fact("avg7_protein", js_round(avg(recent, "protein")), "g"))

    # Measured maintenance: intake on days inside the weigh-in span vs the weight slope.
    # Its window is Insights' (src/features/insights/useAdaptiveTDEE.ts: weigh-ins
    # since 28 days before today), so the two screens agree on the number.
    since = day(NUTRITION_WINDOW_DAYS)
    w = sorted((d, lb) for d, lb in weights if d >= since)
    if len(w) >= 2:
        first, last = w[0][0], w[-1][0]
        span = (date.fromisoformat(last) - date.fromisoformat(first)).days
        in_span = [
            t["kcal"]
            for d, t in sorted(totals.items())
            if first <= d <= last and t.get("kcal", 0) >= ADAPTIVE_MIN_DAY_KCAL
        ]
        slope = _slope(
            [(date.fromisoformat(d) - date.fromisoformat(first)).days for d, _ in w],
            [lb for _, lb in w],
        )
        if span >= ADAPTIVE_MIN_SPAN_DAYS and len(in_span) >= ADAPTIVE_MIN_LOGGED_DAYS and slope:
            tdee = js_round(sum(in_span) / len(in_span) - slope * KCAL_PER_LB)
            out.add(Fact("tdee_kcal", tdee, "kcal"))
            out.add(Fact("trend_lb_week", to_fixed(abs(slope * 7), 2), "lb/week"))
            out.add(Fact("trend_direction", 1 if slope >= 0 else -1, "sign"))

    if len(days) >= MIN_DAYS_FOR_MICROS:
        for key, label, dv in MICROS:
            out.add(Fact(f"micro_{key}_pct", js_round(avg(days, key) / dv * 100), "%"))
            out.names.add(label)


def _slope(xs: list[int], ys: list[float]) -> float | None:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    return None if den == 0 else sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / den


# -- expressions --------------------------------------------------------------------------

_OPS: dict[type, Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


class _Evaluator:
    """+ - * / over numbers and fact names, abs() and round(); nothing else."""

    def __init__(self, facts: Facts) -> None:
        self._facts = facts

    def run(self, expr: str) -> float:
        return self._node(ast.parse(expr, mode="eval").body)

    def _node(self, node: ast.expr) -> float:
        if isinstance(node, ast.Constant) and isinstance(node.value, int | float):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id not in self._facts.facts:
                raise KeyError(f"no fact named {node.id!r}")
            return self._facts[node.id]
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](self._node(node.left), self._node(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -self._node(node.operand)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in ("abs", "round")
            and len(node.args) == 1
        ):
            value = self._node(node.args[0])
            return abs(value) if node.func.id == "abs" else float(js_round(value))
        raise ValueError(f"not allowed in a fact expression: {ast.dump(node)}")


def names_in(expr: str) -> Iterable[str]:
    return {n.id for n in ast.walk(ast.parse(expr, mode="eval")) if isinstance(n, ast.Name)} - {
        "abs",
        "round",
    }
