"""The automatic fact checker: every checkable claim in a reply, against the user's data.

A reply passes `grounded` when every number, date and food it attributes to the
user is backed by the snapshot the model saw (aievals/facts.py, visible facts),
by the question itself, or by plain arithmetic on those. What code decides, and
what it hands on:

- Numbers. Each figure is pulled out with its unit (kcal, g, lb, lb/week, g/lb,
  %, days...) and the clause it sits in. A figure in a clause that is plainly
  about the user ("you averaged 1,640", "your goal") must be backed. One in a
  clause that is plainly general advice ("aim for 30 g per meal") is not a
  claim about the user and is not checked here. One in a clause that is neither
  is `unclear`: if it is also unbacked, the live tier asks the judge whether it
  is presented as the user's own data (rubrics/number_provenance.md).
- A single day. A figure for one day ("on Tuesday you ate 1,800") is backed only
  by a per-day fact or the question: the snapshot's averages and goal don't
  count, so quoting the goal as Tuesday's intake is caught.
- Dates. Any past date must be one the snapshot states; a weekday written next
  to a date must be that date's weekday.
- Foods. A food the reply says the user ate or logged must be one the snapshot
  names. The snapshot names no diary food at all, so any is invented.

Backed means within a unit's rounding tolerance: "about 1,600" for 1,642 is a
rounding, "1,700" is not. Arithmetic covers sums, differences, x7 and /7,
macro calories (4/4/9), rate x weeks and weight change over time, ratios and
percentages, between figures of compatible units. It is deliberately the
arithmetic a coach does, not every combination of every number: the more
combinations, the more an invented figure matches one by chance.

Numbers written as words ("three sessions") are not checked.
"""

import itertools
import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from aievals.facts import Facts

Who = Literal["user", "general", "unclear"]

# Units whose figures are checked; anything else (minutes, reps, servings...) isn't.
CHECKED = frozenset({"kcal", "g", "lb", "lb/week", "g/lb", "g/kg", "%", "kcal/g", "days", "weeks"})

_UNIT_AFTER: tuple[tuple[str, str], ...] = (
    (
        "kcal/g",
        r"\s*(?:kcal|k?cal(?:orie)?s?)\s*(?:/\s*|per\s+|a\s+|in\s+(?:a|one|each|every)\s+"
        r"|for\s+(?:a|each|every)\s+)(?:g\b|grams?\b)",
    ),
    (
        "g/kg",
        r"\s*(?:g|grams?)(?:\s+of\s+protein)?\s*(?:/\s*|per\s+|a\s+|for\s+(?:each|every)\s+)"
        r"(?:kg\b|kilo)",
    ),
    (
        "g/lb",
        r"\s*(?:g|grams?)(?:\s+of\s+protein)?\s*(?:/\s*|per\s+|a\s+|for\s+(?:each|every)\s+)"
        r"(?:(?:lb|lbs)\b|pounds?\b)(?:\s+of)?(?:\s+(?:body\s*weight|bw))?",
    ),
    ("lb/week", r"\s*(?:lbs?|pounds?)\s*(?:/\s*|per\s+|a\s+|an\s+|each\s+|every\s+)(?:wk\b|week)"),
    ("lb", r"\s*x\s*\d+"),  # 50x10: a set's weight
    ("days", r"\s+(?:of|out of)\s+(?:the\s+)?(?:last|past)\s+\d+\s+days"),
    ("kcal", r"\s*-?\s*(?:kcal\b|k?cals?\b|calories\b|calorie\b)"),
    ("g", r"\s*(?:g\b|grams?\b|gm\b)"),
    ("lb", r"\s*(?:lbs?\b|pounds?\b)"),
    ("kg", r"\s*(?:kg\b|kilos?\b|kilograms?\b)"),
    ("%", r"\s*(?:%|percent\b|per\s+cent\b)"),
    ("days", r"\s*-?\s*days?\b"),
    ("weeks", r"\s*-?\s*(?:weeks?|wks?)\b"),
    (
        "other",
        r"\s*-?\s*(?:min(?:ute)?s?|reps?|sets?|sessions?|workouts?|times?|hours?|hrs?|h\b"
        r"|meals?|servings?|eggs?|slices?|cups?|tbsp|tsp|oz\b|ounces?|ml\b|steps?|words?|sentences?"
        r"|bpm|years?|y\b|cm\b|months?|nights?|shifts?|scoops?|pieces?|bars?|am\b|pm\b)",
    ),
)
_UNIT_RES = [(u, re.compile(p, re.IGNORECASE)) for u, p in _UNIT_AFTER]
_NUMBER = re.compile(r"(?<![\w.])(?:~\s*)?(\d+(?:\.\d+)?)(k\b)?")
_RANGE_TAIL = re.compile(r"\s*(?:-|\N{EN DASH}|\N{EM DASH}|to)\s*\d", re.IGNORECASE)
_APPROX = re.compile(
    r"(?:about|around|roughly|approximately|approx\.?|nearly|almost|close to|~|some|circa"
    r"|ballpark of|in the region of)\s*$",
    re.IGNORECASE,
)
_BOUND = re.compile(
    r"(?P<below>under|below|less than|fewer than|short of|up to|at most|no more than)\s*$"
    r"|(?P<above>over|above|more than|at least|north of|upwards of)\s*$",
    re.IGNORECASE,
)
# A bare figure takes its unit from what its clause is about.
_INFER = (
    ("kcal", re.compile(r"calori|kcal|\bcals?\b|maintenance|tdee|deficit|surplus", re.I)),
    ("g", re.compile(r"protein|carb|\bfat\b|fiber|fibre", re.I)),
    ("lb", re.compile(r"weigh|bodyweight|lighter|heavier", re.I)),
)

_DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday"
_MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ]
    )
    for m in names
}
_MONTH = "|".join(sorted(_MONTHS, key=len, reverse=True))
_ISO = re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b")
_MONTH_DAY = re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(20\d\d))?", re.I)
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({_MONTH})\b", re.I)
_WEEKDAY_NEAR = re.compile(rf"\b({_DAYS})\b", re.I)

# Clause is about the user's own data ...
_USER = re.compile(
    r"\byou(?:'ve|'re|\s+have|\s+are|\s+were|\s+had)?\s+(?:been\s+|currently\s+|now\s+|only\s+)?"
    r"(?:averag\w*|eat\w*|ate|had|logged|log|logging|consum\w*|took\s+in|tak\w+\s+in|hitting|hit"
    r"|getting|sitting|down|up|lost|gained|dropped|weigh\w*|trending|losing|gaining|burn\w*"
    r"|at\s+(?:about\s+|around\s+|roughly\s+)?\d)\b"
    r"|\byour\s+(?:[\w-]+\s+){0,3}?(?:average|avg|intake|goal|target|maintenance|tdee|weight"
    r"|bodyweight|log|diary|deficit|surplus|trend|total|rate|pace|numbers?|snapshot|calories"
    r"|protein|carbs?|fat|fiber|days?|week|month)\b"
    r"|\b(?:you|your)\b[^.]*\b(?:logged|recorded|measured|tracked)\b"
    r"|\bin\s+your\s+(?:log|diary|data|snapshot)\b"
    rf"|\bon\s+(?:{_DAYS})\b|\byesterday\b|\bso\s+far\s+today\b|\blast\s+(?:week|month)\b",
    re.IGNORECASE,
)
# ... or plainly general advice.
_GENERAL = re.compile(
    r"\b(?:aim(?:ing)?\s+(?:for|at)|try|target(?:ing)?\s+(?:of|around|about)|consider|add(?:ing)?"
    r"|swap|bump|increase|raise|boost|drop\s+to|cut\s+(?:to|back)|go\s+(?:to|up|down)|per\s+meal"
    r"|per\s+serving|a\s+serving|each\s+meal|typically|generally|usually|most\s+people|research"
    r"|studies|evidence|e\.g\.|for\s+example|such\s+as|rule\s+of\s+thumb|contains?|provides?"
    r"|has\s+(?:about|around|roughly)|per\s+100|a\s+(?:large|medium|small)|if\s+you|would|could"
    r"|should|might|recommend\w*|guideline|range|instead|each\s+gram|per\s+gram|a\s+gram|one\s+gram"
    r"|pound\s+of\s+(?:body\s+)?fat)\b",
    re.IGNORECASE,
)
_INTAKE_VERB = re.compile(r"\b(?:ate|eat|eaten|eating|had|logged|consumed|took\s+in|got)\b", re.I)
_DAY_REF = re.compile(
    rf"\b(?:on\s+)?(?:{_DAYS})\b|\byesterday\b|\btoday\b|\bthat\s+day\b|\bon\s+<date>", re.I
)
_CONDITIONAL = re.compile(
    r"\b(?:if|could|should|would|try|add|swap|consider|instead|maybe|might|like|such\s+as)\b", re.I
)
_FOOD_ATTRIBUTION = re.compile(
    r"\byou(?:'ve|'re|\s+have|\s+are|\s+were)?\s+(?:been\s+|mostly\s+|mainly\s+|also\s+)?"
    r"(?:ate|eat(?:ing|en|s)?|had|having|logged|logging|log)\b"
    r"|\byour\s+(?:\w+\s+)?(?:breakfasts?|lunch(?:es)?|dinners?|snacks?|meals?)\b"
    r"|\b(?:in|from)\s+your\s+(?:log|diary|meals)\b|\bthe\s+\w+(?:\s+\w+)?\s+you\s+(?:ate|had|logged)\b",
    re.IGNORECASE,
)

# Common foods a reply might put in the user's diary. Longest first, so "peanut
# butter" is one food, not "butter".
FOODS = sorted(
    {
        "chicken",
        "chicken breast",
        "rice",
        "brown rice",
        "oats",
        "oatmeal",
        "overnight oats",
        "yogurt",
        "greek yogurt",
        "eggs",
        "egg",
        "egg whites",
        "omelette",
        "omelet",
        "salmon",
        "tuna",
        "cod",
        "shrimp",
        "beef",
        "steak",
        "ground beef",
        "turkey",
        "pork",
        "bacon",
        "ham",
        "sausage",
        "pasta",
        "spaghetti",
        "noodles",
        "bread",
        "toast",
        "bagel",
        "sandwich",
        "wrap",
        "burrito",
        "tacos",
        "pizza",
        "burger",
        "fries",
        "chips",
        "banana",
        "apple",
        "berries",
        "blueberries",
        "strawberries",
        "orange",
        "grapes",
        "avocado",
        "salad",
        "soup",
        "lentil soup",
        "lentils",
        "beans",
        "chickpeas",
        "tofu",
        "tempeh",
        "quinoa",
        "potato",
        "potatoes",
        "sweet potato",
        "cereal",
        "granola",
        "milk",
        "cheese",
        "cottage cheese",
        "peanut butter",
        "almonds",
        "nuts",
        "cashews",
        "protein shake",
        "shake",
        "smoothie",
        "whey",
        "protein powder",
        "protein bar",
        "granola bar",
        "cookies",
        "cookie",
        "cake",
        "ice cream",
        "chocolate",
        "candy",
        "soda",
        "juice",
        "beer",
        "wine",
        "coffee",
        "latte",
        "stir-fry",
        "stir fry",
        "bolognese",
        "lasagna",
        "sushi",
        "poke",
        "curry",
        "hummus",
        "crackers",
        "popcorn",
        "muffin",
        "pancakes",
        "waffles",
        "donut",
        "croissant",
        "broccoli",
        "spinach",
        "vegetables",
        "veggies",
        "fruit",
    },
    key=len,
    reverse=True,
)
_FOOD_RES = [(f, re.compile(rf"\b{re.escape(f)}s?\b", re.IGNORECASE)) for f in FOODS]

MISSING = re.compile(
    r"\b(?:don'?t|do\s+not|doesn'?t|does\s+not|can'?t|cannot|can\s+not|isn'?t|is\s+not|aren'?t"
    r"|are\s+not|wasn'?t|haven'?t|hasn'?t|didn'?t|won'?t|no\s+way\s+to)\b[^.!?\n]{0,80}?"
    r"\b(?:have|see|show|shows|track|tracked|log|logged|record|recorded|data|break\s*down|breakdown"
    r"|access|available|visible|included|include|includes|capture|captured|contain|contains|tell"
    r"|know|itemi[sz]ed|per-day|day-by-day|individual)\b"
    r"|\bonly\s+(?:see|have|shows?|gives?|includes?|got)\b[^.!?\n]{0,60}\b(?:averages?|totals?"
    r"|summar(?:y|ies)|overall|28-day|7-day|weekly)\b"
    r"|\b(?:not|isn'?t|aren'?t)\s+(?:in|part\s+of)\s+(?:your|the|my|what)\b"
    r"|\bno\s+(?:record|records|data|log|entries|breakdown|per-day|day-by-day|daily|meal|way)\b"
    r"|\bnot\s+(?:tracked|logged|recorded|available|something\s+(?:i|the\s+app))\b"
    r"|\b(?:without|lacking)\s+(?:that|the|a|any)\s+(?:data|log|breakdown|detail)\b"
    r"|\bdoesn'?t\s+(?:break|split)\b|\bunknown\b|\bnothing\s+(?:logged|recorded|in\s+your)\b",
    re.IGNORECASE,
)
HEDGE = re.compile(
    r"\b(?:about|around|roughly|approximately|approx|varies|vary|varying|depends|depending"
    r"|typically|usually|on\s+average|ballpark|estimate[sd]?|range|ranges|between|anywhere\s+from"
    r"|give\s+or\s+take|rough(?:ly)?|depending\s+on|generally|average|averages|up\s+to"
    r"|or\s+so|-ish|per\s+100)\b|~|\N{PLUS-MINUS SIGN}",
    re.IGNORECASE,
)

# Figures that are general knowledge, not anyone's data: a reply may state them
# without them being in the log (kcal per gram of protein/carb/fat/alcohol, a
# pound of fat, the usual daily deficit for 1 lb a week).
CONSTANTS: dict[str, tuple[float, ...]] = {
    "kcal/g": (4, 9, 7),
    "kcal": (3500, 500),
    "g/lb": (0.7, 0.8, 0.9, 1.0),  # the protein range the trainer's own rules give
}

# Tolerances: an exact match within `abs`, or a rounding to one of `steps`
# within `rel` of the true figure.
_TOL: dict[str, tuple[float, tuple[float, ...], float]] = {
    "kcal": (2, (5, 10, 25, 50, 100), 0.05),
    "g": (1, (5, 10), 0.08),
    "lb": (0.15, (0.5, 1, 5), 0.1),
    "lb/week": (0.03, (0.05, 0.1, 0.25, 0.5), 0.2),
    "g/lb": (0.015, (0.05, 0.1), 0.1),
    "g/kg": (0.05, (0.1, 0.5), 0.1),
    "%": (1, (5, 10), 0.15),
    "kcal/g": (0.01, (), 0),
    "days": (0, (), 0),
    "weeks": (0.15, (0.5, 1), 0.15),
    "kg": (0.1, (0.5, 1), 0.02),
}


@dataclass(frozen=True)
class Claim:
    value: float
    unit: str | None  # None: a bare figure whose clause names no unit
    text: str  # as written, e.g. "~1,640 kcal"
    clause: str
    who: Who
    per_day: bool  # a figure for one day
    support: str | None  # how it is backed, or None

    @property
    def backed(self) -> bool:
        return self.support is not None


@dataclass(frozen=True)
class FactCheck:
    claims: list[Claim] = field(default_factory=list)
    foods: list[str] = field(default_factory=list)  # attributed to the user, not in the log
    dates: list[str] = field(default_factory=list)  # stated, not in the log (or wrong weekday)

    @property
    def checked(self) -> list[Claim]:
        """Claims about the user, or that might be: what the hallucination rate counts."""
        return [c for c in self.claims if c.who != "general"]

    @property
    def unsupported(self) -> list[Claim]:
        """Code-decided: figures plainly about the user that their data doesn't back."""
        return [c for c in self.claims if c.who == "user" and not c.backed]

    @property
    def unclear(self) -> list[Claim]:
        """Unbacked figures code can't attribute: the judge decides (number_provenance)."""
        return [c for c in self.claims if c.who == "unclear" and not c.backed]

    @property
    def problems(self) -> list[str]:
        out = [f"{c.text!r} in {c.clause!r}" for c in self.unsupported]
        out += [f"food {f!r} attributed to the user" for f in self.foods]
        out += [f"date {d}" for d in self.dates]
        return out


def check(reply: str, facts: Facts, question: str = "", memory: Sequence[str] = ()) -> FactCheck:
    today = date.fromisoformat(facts.today)
    text = _normalise(reply)
    asked = _normalise(" ".join([question, *memory]))

    bad_dates = _check_dates(text, facts, asked, today)
    stripped = _strip_dates(text)
    pool = _Pool(facts, [v for v, _, _, _ in _numbers(_strip_dates(asked))])

    claims: list[Claim] = []
    foods: list[str] = []
    for clause in _clauses(stripped):
        who = _who(clause)
        about = topics(clause)
        per_day = bool(_DAY_REF.search(clause) and _INTAKE_VERB.search(clause)) and who != "general"
        for value, unit, written, how in _numbers(clause):
            if unit == "other":
                continue
            if unit is None:
                unit = _infer_unit(clause) if value >= 10 else None
                if unit is None and (who != "user" or value < 10):
                    continue
            if unit is not None and unit not in CHECKED:
                continue
            if unit in ("days", "weeks") and who != "user":
                continue
            support = pool.support(value, unit, how, per_day=per_day, who=who, about=about)
            claims.append(Claim(value, unit, written, clause.strip(), who, per_day, support))
        foods += _attributed_foods(clause, facts, asked)
    return FactCheck(claims, sorted(set(foods)), bad_dates)


def says_missing(reply: str) -> bool:
    return MISSING.search(_normalise(reply)) is not None


def hedges(reply: str) -> bool:
    return HEDGE.search(reply) is not None


def numbers_with_units(reply: str) -> list[tuple[float, str | None]]:
    """(value, unit) for every figure in the reply, dates removed."""
    out = []
    for clause in _clauses(_strip_dates(_normalise(reply))):
        for value, unit, _, _ in _numbers(clause):
            out.append((value, unit if unit is not None else _infer_unit(clause)))
    return out


# -- parsing ----------------------------------------------------------------------------


def _normalise(text: str) -> str:
    text = text.replace("\N{MINUS SIGN}", "-").replace("\N{NON-BREAKING HYPHEN}", "-")
    text = text.replace("\N{NO-BREAK SPACE}", " ").replace("\N{THIN SPACE}", " ")
    text = text.replace("\N{RIGHT SINGLE QUOTATION MARK}", "'")
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)  # 1,800 -> 1800
    # Names with digits in them (Vitamin D3, B12, RPE8) aren't figures.
    return re.sub(r"\b[A-Za-z]+\d+\b", " ", text)


def _strip_dates(text: str) -> str:
    for pattern in (_ISO, _MONTH_DAY, _DAY_MONTH):
        text = pattern.sub(" <date> ", text)
    return re.sub(r"\b\d{1,2}:\d\d\b", " ", text)  # times of day


def _clauses(text: str) -> list[str]:
    """Sentences, then the parts a coach joins with ', so' / ', but' / ';' / a dash."""
    sentences = re.split(r"(?<=[.!?])\s+|\n+|(?<=\.)$", text)
    parts: list[str] = []
    for s in sentences:
        parts += re.split(
            r";|\s[\N{EM DASH}\N{EN DASH}]\s|\s-\s"
            r"|,\s*(?=(?:so|but|and|which|while|then|because|though|whereas"
            r"|below|above|under|over|against|versus|vs|compared|than|well|short|within"
            r"|up\s+from|down\s+from)\b)"
            r"|\s(?=(?:so|but)\s)|:\s+(?=[a-z])",
            s,
            flags=re.IGNORECASE,
        )
    return [p for p in parts if p and p.strip()]


def _numbers(clause: str) -> Iterable[tuple[float, str | None, str, str]]:
    """(value, unit, as written, approx|below|above|exact) for each figure in a clause."""
    matches = list(_NUMBER.finditer(clause))
    for i, m in enumerate(matches):
        if clause[max(0, m.start() - 1) : m.start()] == "#":
            continue
        value = float(m.group(1)) * (1000 if m.group(2) else 1)
        tail = clause[m.end() :]
        unit = _unit(tail)
        if unit is None and _RANGE_TAIL.match(tail) and i + 1 < len(matches):
            unit = _unit(clause[matches[i + 1].end() :])  # 25-35 g: both are grams
        head = clause[: m.start()]
        how = "approx" if ("~" in m.group(0) or _APPROX.search(head)) else "exact"
        if b := _BOUND.search(head):
            how = "below" if b.group("below") else "above"
        unit_text = ""
        if unit is not None:
            for u, pattern in _UNIT_RES:
                if u == unit and (um := pattern.match(tail)):
                    unit_text = um.group(0)
                    break
        yield value, unit, (m.group(0) + unit_text).strip(), how


def _unit(tail: str) -> str | None:
    for unit, pattern in _UNIT_RES:
        if pattern.match(tail):
            return unit
    return None


def _infer_unit(clause: str) -> str | None:
    found = [u for u, pattern in _INFER if pattern.search(clause)]
    return found[0] if len(found) == 1 else None


def _who(clause: str) -> Who:
    user = bool(_USER.search(clause))
    general = bool(_GENERAL.search(clause))
    if user and not general:
        return "user"
    if general and not user:
        return "general"
    return "unclear"


def _attributed_foods(clause: str, facts: Facts, asked: str) -> list[str]:
    if not _FOOD_ATTRIBUTION.search(clause) or _CONDITIONAL.search(clause):
        return []
    known = " ".join([*facts.names, asked]).lower()
    found, rest = [], clause
    for food, pattern in _FOOD_RES:
        if pattern.search(rest):
            rest = pattern.sub(" ", rest)
            if food not in known:
                found.append(food)
    # One entry per clause: "chicken stir-fry" is one invented meal, not two.
    return [" + ".join(sorted(found))] if found else []


def _check_dates(text: str, facts: Facts, asked: str, today: date) -> list[str]:
    allowed = set(facts.dates) | {d.isoformat() for d, _ in _dates(asked, today)}
    bad = []
    for d, where in _dates(text, today):
        iso = d.isoformat()
        if d <= today and iso not in allowed:
            bad.append(f"{iso} (not in the log)")
        weekday = _WEEKDAY_NEAR.search(text[max(0, where - 14) : where + 30])
        if weekday and weekday.group(1).lower() != d.strftime("%A").lower():
            bad.append(f"{iso} is a {d.strftime('%A')}, not a {weekday.group(1).title()}")
    return bad


def _dates(text: str, today: date) -> list[tuple[date, int]]:
    out = []
    for m in _ISO.finditer(text):
        try:
            out.append((date(int(m[1]), int(m[2]), int(m[3])), m.start()))
        except ValueError:
            continue
    for m in _MONTH_DAY.finditer(text):
        out += _resolve(_MONTHS[m[1].lower()], int(m[2]), m[3], today, m.start())
    for m in _DAY_MONTH.finditer(text):
        out += _resolve(_MONTHS[m[2].lower()], int(m[1]), None, today, m.start())
    return out


def _resolve(
    month: int, day: int, year: str | None, today: date, where: int
) -> list[tuple[date, int]]:
    try:
        d = date(int(year) if year else today.year, month, day)
    except ValueError:
        return []
    if not year and d > today and (d - today).days > 60:
        d = d.replace(year=d.year - 1)  # "Dec 30" said in January
    return [(d, where)]


# -- support -----------------------------------------------------------------------------

# What a clause is about, to match it to facts on the same topic (aievals/facts.py).
_TOPIC_CUES = {
    "intake": re.compile(
        r"averag|intake|\beat|\bate\b|eaten|consum|logged|taking\s+in|took\s+in|been\s+having",
        re.I,
    ),
    "target": re.compile(r"\bgoal|target|budget|allowance", re.I),
    "maintenance": re.compile(r"maintenance|tdee|\bburn|expenditure", re.I),
    "bodyweight": re.compile(
        r"weigh|body\s*weight|lighter|heavier|losing|lost|\bgain|\bscale\b|\bdown\b|\bup\b", re.I
    ),
    "lift": re.compile(
        r"squat|bench|deadlift|press|\brow|curl|\blift|rdl|1rm|one-rep|\bsets?\b|\breps?\b", re.I
    ),
}


def topics(clause: str) -> frozenset[str]:
    return frozenset(t for t, cue in _TOPIC_CUES.items() if cue.search(clause))


@dataclass(frozen=True)
class _Value:
    value: float
    label: str
    topic: str | None = None
    from_question: bool = False


class _Pool:
    """Every figure a reply may state about the user, and how each is backed."""

    def __init__(self, facts: Facts, asked: list[float]) -> None:
        self._asked = [_Value(v, "the question", None, True) for v in asked]
        visible = facts.visible()
        self._facts: dict[str, list[_Value]] = {}
        for f in visible:
            self._facts.setdefault(f.unit, []).append(_Value(f.value, f"fact {f.name}", f.topic))
        self._per_day = [_Value(f.value, f"fact {f.name}", f.topic) for f in visible if f.day]
        self._named = {f.name: _Value(f.value, f"fact {f.name}", f.topic) for f in visible}
        self._derived = self._derive()

    def _of(self, unit: str, topic: str | None = None) -> list[_Value]:
        mine = self._facts.get(unit, [])
        if topic is not None:
            mine = [v for v in mine if v.topic == topic]
        return [*mine, *self._asked]

    def _derive(self) -> dict[str, list[_Value]]:
        """The arithmetic a coach does on the snapshot, and nothing wider."""
        d: dict[str, list[_Value]] = {}

        def add(unit: str, value: float, label: str, *parts: _Value) -> None:
            if math.isfinite(value) and value > 0:
                q = any(p.from_question for p in parts)
                # Arithmetic on one topic stays on it: the targets' macro calories
                # are a target, never something the user ate.
                shared = {p.topic for p in parts}
                topic = shared.pop() if len(shared) == 1 else None
                d.setdefault(unit, []).append(_Value(value, label, topic, q))

        # Sums and differences within a unit (lb: within bodyweight, or within lifts).
        groups = [(u, self._of(u)) for u in ("kcal", "g", "days", "lb/week")]
        groups += [("lb", self._of("lb", "bodyweight")), ("lb", self._of("lb", "lift"))]
        for unit, vals in groups:
            for a, b in itertools.combinations(vals, 2):
                add(unit, abs(a.value - b.value), f"{a.label} - {b.label}", a, b)
                add(unit, a.value + b.value, f"{a.label} + {b.label}", a, b)
        # A week of a daily figure, or a day of a weekly one.
        for unit in ("kcal", "g"):
            for v in [*self._of(unit), *d.get(unit, [])]:
                add(unit, v.value * 7, f"({v.label}) x 7", v)
                add(unit, v.value / 7, f"({v.label}) / 7", v)
        # Grams to calories (4/4/9), and the macros' total.
        for name, per in (("protein", 4), ("carb", 4), ("fat", 9)):
            for fact in (f"avg28_{name}", f"avg7_{name}", f"{name}_target_g"):
                if grams := self._named.get(fact):
                    add("kcal", grams.value * per, f"{per} x {grams.label}", grams)
        for p, c, f in (
            ("avg28_protein", "avg28_carb", "avg28_fat"),
            ("protein_target_g", "carb_target_g", "fat_target_g"),
        ):
            if all(n in self._named for n in (p, c, f)):
                n = self._named
                total = 4 * n[p].value + 4 * n[c].value + 9 * n[f].value
                add("kcal", total, f"4 x {p} + 4 x {c} + 9 x {f}", n[p], n[c], n[f])
        # Per pound of bodyweight, and protein targets worked out from it.
        weights = [w for w in self._of("lb", "bodyweight") if w.value >= 60]  # not a change
        for w in weights:
            for g in self._of("g"):
                add("g/lb", g.value / w.value, f"{g.label} / {w.label}", g, w)
            for k in (0.7, 0.75, 0.8, 0.9, 1.0, 1.1, 1.2):
                add("g", w.value * k, f"{k} x {w.label}", w)
        # Rates: a weight change over its span, a deficit as lb/week, and back.
        span, delta = self._named.get("weight_span_days"), self._named.get("weight_delta_lb")
        if span and delta:
            add("lb/week", delta.value / span.value * 7, "weight change per week", delta, span)
        for kcal in [*self._of("kcal"), *d.get("kcal", [])]:
            add("lb/week", kcal.value * 7 / 3500, f"({kcal.label}) x 7 / 3500", kcal)
        for r in [*self._of("lb/week"), *d.get("lb/week", [])]:
            add("kcal", r.value * 500, f"{r.label} x 500", r)
            for lb in [*self._of("lb", "bodyweight"), *self._asked]:
                add("weeks", lb.value / r.value, f"{lb.label} / {r.label}", lb, r)
            for n in [*range(1, 13), *(a.value for a in self._asked)]:
                add("lb", r.value * n, f"{r.label} x {n}", r)
                for w in weights:
                    add("lb", w.value - r.value * n, f"{w.label} - {r.label} x {n}", w, r)
        for days in self._of("days"):
            add("weeks", days.value / 7, f"{days.label} / 7", days)
        # Percentages: intake against its target, or against maintenance.
        for unit in ("kcal", "g"):
            for a in self._of(unit, "intake"):
                for b in [*self._of(unit, "target"), *self._of(unit, "maintenance")]:
                    if b.value:
                        add("%", a.value / b.value * 100, f"{a.label} / {b.label}", a, b)
        return d

    def support(
        self,
        value: float,
        unit: str | None,
        how: str,
        *,
        per_day: bool,
        who: Who,
        about: frozenset[str] = frozenset(),
    ) -> str | None:
        for u in [unit] if unit else list(self._facts):
            if per_day:
                # One day's figure: only a per-day fact, or arithmetic on the question.
                direct = [*self._per_day, *self._asked]
                derived = [v for v in self._derived.get(u, []) if v.from_question]
            else:
                # A figure on one topic is backed only by a fact on that topic.
                def on_topic(v: _Value) -> bool:
                    return not about or v.topic in (None, *about)

                direct = [v for v in self._of(u) if on_topic(v)]
                derived = [v for v in self._derived.get(u, []) if on_topic(v)]
            for v in direct:
                if _close(value, v.value, u, how):
                    return v.label
            for v in derived:
                if _close(value, v.value, u, how):
                    return f"derived: {v.label}"
            if who != "user" and not per_day:
                for c in CONSTANTS.get(u, ()):
                    if _close(value, c, u, how):
                        return "general constant"
        return None


def _close(claimed: float, true: float, unit: str, how: str) -> bool:
    tol, steps, rel = _TOL.get(unit, (0, (), 0))
    if abs(claimed - true) <= tol + 1e-9:
        return True
    if not true:
        return False
    for step in steps:
        if not math.isclose(claimed / step, round(claimed / step), abs_tol=1e-9):
            continue
        if abs(claimed - true) / abs(true) > rel:
            continue
        if how == "below" and true < claimed and claimed - true <= step:
            return True
        if how == "above" and true > claimed and true - claimed <= step:
            return True
        nearest = round(true / step) * step
        if math.isclose(claimed, nearest, abs_tol=1e-9):
            return True
        # A one-sided rounding ("about 1,600" for 1,642 rounds down to the 100).
        if how == "approx" and abs(claimed - true) < step:
            return True
    return False
