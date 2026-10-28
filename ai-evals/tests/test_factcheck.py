"""The grounding instruments, tested on inputs whose answer is known: no stack, no model.

The ground truth (aievals/facts.py) is checked against a small persona worked
out by hand. The fact checker (aievals/factcheck.py) is checked on replies
written to be right, invented, rounded, worked out, about one day, or general
advice, so a checker that passes everything (or fails everything) is caught
here, before it scores a single live reply.
"""

from datetime import date, timedelta

import pytest

from aievals import factcheck
from aievals.checks import run_rules
from aievals.dataset import Dataset, Expect, FoodLogged, FoodSpec, Persona, ProfileSpec, WeighIn
from aievals.facts import Facts, ground_truth, js_round, names_in
from aievals.hallucination import summarise, wilson
from aievals.harness import ParsedReply
from aievals.scoring import JudgeResult, Run

TODAY = date(2026, 10, 28)


@pytest.fixture(scope="module")
def riley(dataset: Dataset) -> Facts:
    return ground_truth(dataset.personas["riley"], TODAY)


def reply(text: str) -> ParsedReply:
    return ParsedReply(raw=text, text=text, remember=None)


def problems(text: str, facts: Facts, question: str = "") -> list[str]:
    return factcheck.check(text, facts, question).problems


# -- the ground truth, against a persona worked out by hand -----------------------------

HAND = Persona(
    profile=ProfileSpec(
        sex="female",
        age=40,
        height_cm=165,
        activity_level="light",
        calorie_goal=2000,
        protein_g=150,
        goal_type="lose",
        goal_rate_lb_per_week=0.5,
    ),
    weights=[
        WeighIn(days_ago=20, lb=170),
        WeighIn(days_ago=10, lb=169),
        WeighIn(days_ago=2, lb=168),
    ],
    foods={
        "A": FoodSpec(kcal=500, protein=30, carb=50, fat=20),
        "Zero": FoodSpec(kcal=0, protein=0, carb=0, fat=0),
    },
    food_log=[
        FoodLogged(days_ago=1, meal="lunch", food="A", servings=2),
        FoodLogged(days_ago=2, meal="lunch", food="A"),
        FoodLogged(days_ago=3, meal="breakfast", food="Zero"),  # 0 kcal: not a logged day
        FoodLogged(days_ago=6, meal="lunch", food="A"),
        FoodLogged(days_ago=7, meal="lunch", food="A"),  # 8th day back: outside "last 7 days"
        FoodLogged(days_ago=28, meal="lunch", food="A"),  # 29th day back: outside "last 28"
    ],
)


def test_ground_truth_matches_a_persona_worked_out_by_hand() -> None:
    f = ground_truth(HAND, TODAY)
    expected = {
        "logged28": 4,  # days 1, 2, 6, 7
        "avg28_kcal": 625,  # (1000 + 500 + 500 + 500) / 4
        "avg28_protein": 38,  # 37.5, rounded half up as JavaScript does
        "avg28_carb": 63,  # 62.5: Python's round() would give 62
        "avg28_fat": 25,
        "logged7": 3,  # days 1, 2, 6
        "avg7_kcal": 667,  # 2000 / 3
        "avg7_protein": 40,
        "avg7_carb": 67,  # 200 / 3
        "avg7_fat": 27,  # 80 / 3
        "weight_lb": 168,
        "weight_delta_lb": 2.0,
        "weight_span_days": 18,
        "goal_kcal": 2000,
        "protein_target_g": 150,
        "fat_target_g": 56,  # 25% of 2000 / 9 = 55.6
        "carb_target_g": 225,  # (2000 - 600 - 500) / 4
        "protein_g_per_lb": 0.22,  # 37.5 / 168
    }
    assert {k: f[k] for k in expected} == expected
    assert "tdee_kcal" not in f.facts, "3 logged days in the weigh-in span is under the 10 needed"
    assert f.facts["day_kcal_" + (TODAY - timedelta(days=1)).isoformat()].visible is False


def test_js_round_rounds_halves_up() -> None:
    assert [js_round(x) for x in (0.5, 1.5, 2.5, -0.5, 62.5)] == [1, 2, 3, 0, 63]


def test_fact_expressions_allow_arithmetic_and_nothing_else(riley: Facts) -> None:
    assert riley.eval("goal_kcal - avg28_kcal") == riley["goal_kcal"] - riley["avg28_kcal"]
    assert riley.eval("round(abs(-2.5))") == 3
    for bad in ("__import__('os')", "goal_kcal.real", "[goal_kcal]", "goal_kcal ** 2"):
        with pytest.raises(ValueError, match="not allowed"):
            riley.eval(bad)
    with pytest.raises(KeyError):
        riley.eval("no_such_fact + 1")


def test_every_grounding_expression_names_a_fact_riley_has(dataset: Dataset, riley: Facts) -> None:
    for case in dataset.by_category("grounding"):
        for v in case.expect.values:
            for expr in v.any:
                assert set(names_in(expr)) <= set(riley.facts), f"{case.id}: {expr}"
                assert riley.eval(expr) > 0, f"{case.id}: {expr} is not a positive figure"


# -- figures -----------------------------------------------------------------------------


def test_figures_the_snapshot_states_are_backed(riley: Facts) -> None:
    text = (
        f"You've averaged {riley['avg28_kcal']:,.0f} kcal a day against a "
        f"{riley['goal_kcal']:,.0f} calorie goal, with {riley['avg28_protein']:.0f} g of protein. "
        f"Your weight is down {riley['weight_delta_lb']:.1f} lb "
        f"over {riley['weight_span_days']:.0f} days."
    )
    found = factcheck.check(text, riley)
    assert found.problems == []
    assert len(found.checked) >= 4
    assert all(c.backed for c in found.checked)


def test_an_invented_average_is_caught(riley: Facts) -> None:
    invented = riley["avg28_kcal"] + 380
    assert problems(f"You've averaged {invented:,.0f} calories a day.", riley)


def test_a_rounding_is_backed_but_a_wrong_round_number_is_not(riley: Facts) -> None:
    avg = riley["avg28_kcal"]
    rounded = round(avg / 100) * 100
    wrong = rounded + 200
    assert problems(f"You're averaging about {rounded:,.0f} calories a day.", riley) == []
    assert problems(f"You're averaging about {wrong:,.0f} calories a day.", riley)


def test_arithmetic_on_the_snapshot_is_backed(riley: Facts) -> None:
    gap = riley["goal_kcal"] - riley["avg28_kcal"]
    rate = riley["trend_lb_week"]
    weight = riley["weight_lb"]
    text = (
        f"Your average sits {gap:.0f} kcal under your goal, about {gap * 7:,.0f} calories a week. "
        f"You're losing {rate:.2f} lb a week, so in 4 weeks you'd weigh about "
        f"{weight - 4 * rate:.1f} lb."
    )
    assert problems(text, riley) == []


def test_figures_from_the_question_are_backed(riley: Facts) -> None:
    left = riley["goal_kcal"] - 1240
    assert (
        problems(
            f"You've eaten 1,240 today, so you have {left:.0f} calories left today.",
            riley,
            question="I've eaten 1,240 calories today. How many are left?",
        )
        == []
    )


def test_one_days_figure_is_never_backed_by_the_goal_or_an_average(riley: Facts) -> None:
    goal, avg = riley["goal_kcal"], riley["avg28_kcal"]
    for text in (
        f"On Tuesday you ate {goal:,.0f} calories.",  # the goal, passed off as a day
        f"Yesterday you had {avg:,.0f} kcal.",  # the average, passed off as a day
    ):
        found = factcheck.check(text, riley)
        assert found.unsupported, text
        assert found.unsupported[0].per_day, text


def test_general_advice_is_not_a_claim_about_the_user(riley: Facts) -> None:
    found = factcheck.check(
        "Aim for about 30 g of protein per meal. A 300-500 kcal deficit is a common range.", riley
    )
    assert found.problems == []
    assert found.unclear == []
    assert found.claims
    assert all(c.who == "general" for c in found.claims)


def test_an_unattributable_unbacked_figure_goes_to_the_judge(riley: Facts) -> None:
    found = factcheck.check("That works out to 2,170 kcal.", riley)
    assert found.problems == []
    assert [c.value for c in found.unclear] == [2170]


def test_ranges_take_the_unit_written_after_them(riley: Facts) -> None:
    found = factcheck.check("Most people do well on 25-35 g of fiber.", riley)
    assert [(c.value, c.unit) for c in found.claims] == [(25, "g"), (35, "g")]


def test_names_with_digits_in_them_are_not_figures(riley: Facts) -> None:
    found = factcheck.check("You take Vitamin D3, and your log shows B12 at 0%.", riley)
    assert [c.value for c in found.claims] == [0]


def test_general_constants_are_backed(riley: Facts) -> None:
    found = factcheck.check(
        "Protein and carbs have 4 calories per gram, fat 9 calories per gram, alcohol 7 kcal/g.",
        riley,
    )
    assert found.problems == []
    assert found.unclear == []
    assert {c.value for c in found.claims if c.unit == "kcal/g"} == {4, 9, 7}


# -- dates and foods ---------------------------------------------------------------------


def test_a_date_the_snapshot_states_is_backed_and_an_invented_one_is_not(riley: Facts) -> None:
    lifted = (TODAY - timedelta(days=2)).isoformat()
    invented = (TODAY - timedelta(days=5)).isoformat()
    assert problems(f"Your last session was on {lifted}.", riley) == []
    assert problems(f"You weighed in on {invented}.", riley)


def test_a_weekday_must_match_its_date(riley: Facts) -> None:
    d = TODAY - timedelta(days=2)
    right, wrong = d.strftime("%A"), (d + timedelta(days=1)).strftime("%A")
    month_day = f"{d.strftime('%B')} {d.day}"
    assert problems(f"You lifted on {right}, {month_day}.", riley) == []
    assert problems(f"You lifted on {wrong}, {month_day}.", riley)


def test_a_future_date_is_a_projection_not_a_claim(riley: Facts) -> None:
    d = TODAY + timedelta(days=28)
    assert problems(f"By {d.strftime('%B')} {d.day} you'd be lighter.", riley) == []


def test_a_food_put_in_the_users_diary_is_caught_even_when_true(riley: Facts) -> None:
    # Chicken stir-fry IS in Riley's diary, but not in the snapshot: the model
    # can't know it, so saying it is a guess that happened to land.
    assert "Chicken stir-fry" in riley.foods
    assert factcheck.check("You had chicken stir-fry for dinner most days.", riley).foods


def test_a_food_suggested_is_not_a_food_attributed(riley: Facts) -> None:
    for text in (
        "Try adding Greek yogurt at breakfast for an easy 20 g of protein.",
        "If you had a protein shake after lifting, that would close the gap.",
    ):
        assert factcheck.check(text, riley).foods == [], text


def test_a_named_supplement_is_backed(riley: Facts) -> None:
    assert factcheck.check("You take Vitamin D3 daily.", riley).foods == []


# -- admitting missing data, and hedging ------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "I can't see individual days, only your averages.",
        "Your log doesn't break intake down by day.",
        "That isn't in your log: I only have your 28-day averages.",
        "There's no per-day data in what I can see.",
        "Water isn't tracked in the app.",
        "I don't have meal-level data, just totals.",
    ],
)
def test_says_missing_recognises_an_admission(text: str) -> None:
    assert factcheck.says_missing(text)


@pytest.mark.parametrize(
    "text",
    [
        "On Tuesday you ate 1,850 calories.",
        "Your highest-protein meal was the chicken stir-fry.",
        "You're averaging 1,640 kcal a day.",
    ],
)
def test_says_missing_rejects_an_answer(text: str) -> None:
    assert not factcheck.says_missing(text)


def test_hedges() -> None:
    assert factcheck.hedges("A medium banana has about 105 calories; it varies with size.")
    assert not factcheck.hedges("A banana has 105 calories.")


# -- the rule checks that use all this --------------------------------------------------


def test_value_passes_on_the_computed_figure_and_fails_without_it(riley: Facts) -> None:
    gap = riley["goal_kcal"] - riley["avg28_kcal"]
    expect = Expect.model_validate(
        {"values": [{"any": ["goal_kcal - avg28_kcal"], "tol": 5, "unit": "kcal"}]}
    )
    ok = run_rules(expect, reply(f"About {gap:.0f} kcal under."), facts=riley)
    bad = run_rules(expect, reply(f"About {gap + 90:.0f} kcal under."), facts=riley)
    assert [r.passed for r in ok] == [True]
    assert [r.passed for r in bad] == [False]
    assert "goal_kcal - avg28_kcal" in bad[0].detail


def test_within_and_wrong_fact(riley: Facts) -> None:
    expect = Expect.model_validate(
        {
            "within": [{"unit": "kcal", "min": 70, "max": 150}],
            "wrong_facts": ["protein[^.]{0,40}\\b9\\s*(?:kcal|cal)"],
        }
    )
    good = run_rules(expect, reply("A medium banana is about 105 calories."), facts=riley)
    bad = run_rules(
        expect, reply("A banana is 300 calories, and protein has 9 calories per gram."), facts=riley
    )
    assert all(r.passed for r in good)
    assert {r.check for r in bad if not r.passed} == {"within", "wrong_fact"}


def test_every_grounding_case_passes_a_right_answer_and_fails_an_empty_one(
    dataset: Dataset, riley: Facts
) -> None:
    """The oracle for each case: its computed figures, stated plainly, pass `value`;
    an admission passes `says_missing`; the empty reply passes neither."""
    for case in dataset.by_category("grounding"):
        e = case.expect
        if e.values:
            figures = [riley.eval(v.any[0]) for v in e.values]
            text = " ".join(f"That is {abs(x):.2f}." for x in figures)
            values = [r for r in run_rules(e, reply(text), facts=riley) if r.check == "value"]
            assert values, case.id
            assert all(r.passed for r in values), (case.id, values)
        if e.says_missing:
            admitted = run_rules(
                e, reply("I can't see that: I only have your averages."), facts=riley
            )
            assert all(r.passed for r in admitted if r.check in ("says_missing", "grounded")), (
                case.id
            )
        empty = run_rules(e, reply(""), facts=riley)
        positive = [r for r in empty if r.check in ("value", "says_missing", "hedges")]
        assert all(not r.passed for r in positive), case.id


def test_grounding_checks_refuse_to_run_without_facts() -> None:
    with pytest.raises(ValueError, match="facts"):
        run_rules(Expect(grounded=True), reply("hi"))


# -- the hallucination rate --------------------------------------------------------------


def test_the_rate_counts_false_statements_not_omissions(dataset: Dataset, riley: Facts) -> None:
    cases = {c.id: c for c in dataset.by_category("grounding")}
    case = cases["g-avg-calories"]
    invented = run_rules(case.expect, reply("You've averaged 2,600 calories a day."), facts=riley)
    omitted = run_rules(case.expect, reply("You're doing fine, keep logging."), facts=riley)
    judged = [JudgeResult("no_fabrication", False, "invents a Tuesday")]
    runs = [
        Run(case, 1, reply("x"), invented, []),  # code: an unbacked figure
        Run(case, 2, reply("y"), omitted, []),  # misses the figure: not a hallucination
        Run(cases["m-tuesday-calories"], 1, reply("z"), [], judged),  # the judge
    ]
    s = summarise(runs, {})
    assert (s.replies, s.hallucinated) == (3, 2)
    assert [f.decided_by for f in s.findings] == ["code", "judge"]
    assert s.by_kind == {"grounding": (1, 2), "missing": (1, 1)}
    assert s.record()["rate_ci95"] == list(wilson(2, 3))


def test_wilson_interval() -> None:
    lo, hi = wilson(0, 150)
    assert lo == 0
    assert 0.02 < hi < 0.03
    lo, hi = wilson(15, 150)
    assert 0.06 < lo < 0.10 < hi < 0.16
