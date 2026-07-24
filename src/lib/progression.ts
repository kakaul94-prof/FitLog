import { estimated1RM } from './calc'
import { addDaysISO, daysBetweenISO } from './date'
import type { ProgressionMethod, StrengthGoal } from './database.types'

// A past set for one exercise. Sessions are arrays of these, newest session
// first; weight/reps may be null (blank prefill rows are filtered out here).
// effort is the logged RPE (1 easy … 10 max), optional — drives autoregulation.
export interface PriorSet {
  weight_lb: number | null
  reps: number | null
  effort?: number | null
}

export interface SuggestedSet {
  weightLb: number | null
  reps: number | null
  amrap?: boolean
}

export type SuggestAction = 'increase' | 'repeat' | 'deload' | 'start'

export interface Suggestion {
  method: ProgressionMethod
  sets: SuggestedSet[]
  headline: string
  action: SuggestAction
  rationale: string
  source: string
}

export const PROGRESSION_LABEL: Record<ProgressionMethod, string> = {
  linear: 'Linear',
  double: 'Double progression',
  '531': '5/3/1',
}

// Shown in-app under each suggestion so the reasoning + its source are visible.
export const PROGRESSION_SOURCE: Record<ProgressionMethod, string> = {
  linear: 'Linear progression — Starting Strength, StrongLifts',
  double: 'Double progression · 2-for-2 rule — NSCA, ACSM',
  '531': '5/3/1 — Wendler',
}

const round5 = (n: number) => Math.round(n / 5) * 5

/** Inverse Epley: the weight that yields `target1RM` at `reps`. */
export function weightForReps(target1RM: number, reps: number): number {
  if (reps <= 1 || target1RM <= 0) return target1RM
  return target1RM / (1 + reps / 30)
}

/**
 * A goal's target for display: "225 × 5", or "225 lb 1RM" for a single-rep
 * goal (Epley leaves a 1-rep target's weight unchanged, so the 1RM reads true).
 */
export function formatGoalTarget(g: {
  target_weight_lb: number
  target_reps: number
  target_1rm_lb: number
}): string {
  return g.target_weight_lb && g.target_reps > 1
    ? `${g.target_weight_lb} × ${g.target_reps}`
    : `${g.target_1rm_lb} lb 1RM`
}

const working = (sets: PriorSet[]) =>
  sets.filter((s) => (s.weight_lb ?? 0) > 0 && (s.reps ?? 0) > 0)

/** Best estimated 1RM across recent sessions — reflects current strength. */
export function currentE1RM(sessions: PriorSet[][], lookback = 5): number {
  let best = 0
  for (const sets of sessions.slice(0, lookback))
    for (const s of sets)
      best = Math.max(best, estimated1RM(s.weight_lb ?? 0, s.reps ?? 0))
  return Math.round(best)
}

// The top working weight of a session + the (min) reps and set count at it, plus
// a representative effort = the MAX RPE logged across the top sets (conservative:
// if any top set was a grind, treat the work as hard). null when none logged.
function sessionTop(
  sets: PriorSet[],
): {
  topWeight: number
  reps: number
  count: number
  effort: number | null
} | null {
  const w = working(sets)
  if (!w.length) return null
  const topWeight = Math.max(...w.map((s) => s.weight_lb as number))
  const atTop = w.filter((s) => s.weight_lb === topWeight)
  const reps = Math.min(...atTop.map((s) => s.reps as number))
  const efforts = atTop
    .map((s) => s.effort)
    .filter((e): e is number => typeof e === 'number')
  return {
    topWeight,
    reps,
    count: atTop.length,
    effort: efforts.length ? Math.max(...efforts) : null,
  }
}

// Weekly 5/3/1 waves: % of training max, reps, and whether the last set is AMRAP.
const W531 = [
  { pct: [0.65, 0.75, 0.85], reps: [5, 5, 5], amrap: true },
  { pct: [0.7, 0.8, 0.9], reps: [3, 3, 3], amrap: true },
  { pct: [0.75, 0.85, 0.95], reps: [5, 3, 1], amrap: true },
  { pct: [0.4, 0.5, 0.6], reps: [5, 5, 5], amrap: false },
]

function suggest531(
  goal: StrengthGoal,
  sessions: PriorSet[][],
  source: string,
): Suggestion {
  const tm = goal.tm_lb ?? Math.round(currentE1RM(sessions) * 0.9)
  if (!tm)
    return {
      method: '531',
      sets: [],
      headline: 'Log a set to start',
      action: 'start',
      rationale:
        'Log this exercise once so we can set your training max (90% of your 1RM).',
      source,
    }
  const wk = W531[Math.min(3, Math.max(0, (goal.week ?? 1) - 1))]
  const sets = wk.pct.map((p, i) => ({
    weightLb: round5(tm * p),
    reps: wk.reps[i],
    amrap: wk.amrap && i === wk.pct.length - 1,
  }))
  return {
    method: '531',
    sets,
    headline: `Week ${goal.week} of 4`,
    action: goal.week >= 4 ? 'deload' : 'increase',
    rationale: `Training max ${tm} lb (90% of your 1RM). ${
      wk.amrap ? 'Last set is AMRAP — push for reps.' : 'Deload week — keep it light.'
    }`,
    source,
  }
}

/**
 * Suggest the next session for a goal'd lift from its history (newest first).
 * linear & double share one engine (linear = a single rep target); 5/3/1 waves
 * off a training max. Returns `action: 'start'` with no sets when there's no
 * history to work from.
 */
export function suggestNext(
  goal: StrengthGoal,
  sessions: PriorSet[][],
): Suggestion {
  const source = PROGRESSION_SOURCE[goal.method]
  if (goal.method === '531') return suggest531(goal, sessions, source)

  const inc = goal.increment_lb ?? 5
  const isDouble = goal.method === 'double'
  const targetReps = isDouble ? goal.rep_high : goal.rep_low
  const bottomReps = goal.rep_low
  const setCount = Math.max(1, goal.sets)

  const sess = sessions.map(working).filter((s) => s.length)
  if (!sess.length)
    return {
      method: goal.method,
      sets: [],
      headline: 'Log a set to start',
      action: 'start',
      rationale: 'Log this exercise once and the suggestion will appear.',
      source,
    }

  const last = sessionTop(sess[0]) as {
    topWeight: number
    reps: number
    count: number
    effort: number | null
  }
  const hit = last.count >= setCount && last.reps >= targetReps
  // Stall = two sessions at the same top weight, neither hitting the target.
  const prev = sess[1] ? sessionTop(sess[1]) : null
  const stalled =
    !hit &&
    prev != null &&
    prev.topWeight === last.topWeight &&
    !(prev.count >= setCount && prev.reps >= targetReps)

  let weight: number
  let reps: number
  let action: SuggestAction
  let rationale: string
  // Whether effort (RPE) changed the suggested jump — appends its source below.
  let usedRpe = false
  if (hit) {
    // Autoregulate the jump by how hard the top sets felt on the 1-10 RPE scale
    // (>=9 = max, <=6 = easy, 7-8 = standard); no RPE logged falls to +inc.
    const e = last.effort
    if (e != null && e >= 9) {
      weight = last.topWeight
      reps = targetReps
      action = 'repeat'
      rationale = `You hit ${last.count}×${last.reps} at ${last.topWeight} lb but it was max effort (RPE ${e}) — hold here to consolidate before adding load.`
      usedRpe = true
    } else if (e != null && e <= 6) {
      const bigInc = round5(inc * 1.5)
      weight = round5(last.topWeight + bigInc)
      reps = bottomReps
      action = 'increase'
      rationale = `You hit ${last.count}×${last.reps} at ${last.topWeight} lb and it felt easy (RPE ${e}) — bigger jump (+${bigInc} lb).`
      usedRpe = true
    } else {
      weight = round5(last.topWeight + inc)
      reps = bottomReps
      action = 'increase'
      rationale = `You hit ${last.count}×${last.reps} at ${last.topWeight} lb — go up ${inc} lb.`
    }
  } else if (stalled) {
    weight = round5(last.topWeight * 0.9)
    reps = bottomReps
    action = 'deload'
    rationale = `Stalled at ${last.topWeight} lb twice — deload ~10% and build back.`
  } else {
    weight = last.topWeight
    reps = isDouble ? Math.min(targetReps, last.reps + 1) : targetReps
    action = 'repeat'
    rationale = isDouble
      ? `Stay at ${last.topWeight} lb and add a rep (aim ${reps}) until ${setCount}×${goal.rep_high}.`
      : `Missed ${targetReps} reps last time — repeat ${last.topWeight} lb.`
  }

  const sets = Array.from({ length: setCount }, () => ({
    weightLb: weight,
    reps,
  }))
  return {
    method: goal.method,
    sets,
    headline: `${setCount} × ${reps} @ ${weight} lb`,
    action,
    rationale,
    source: usedRpe
      ? `${source} · RPE autoregulation — Helms et al., RTS`
      : source,
  }
}

export interface GoalPace {
  /** lb of e1RM still needed to hit the target (0 once reached). */
  remaining: number
  /** lb/week of e1RM gain required to reach the target by the date. */
  neededPerWeek: number
  /** Target date has passed but the goal isn't reached yet. */
  overdue: boolean
}

/**
 * Required pace toward a dated strength goal: the weekly e1RM gain needed to go
 * from `current` to `target` in `daysLeft` days. This is the REQUIRED rate, not
 * a projection from your trend (that lives on the Progress-tab chart). An
 * already-overdue date collapses the remaining gain into a single week so the
 * number stays finite + actionable.
 */
export function requiredPace(
  current: number,
  target: number,
  daysLeft: number,
): GoalPace {
  const remaining = Math.max(0, Math.round(target - current))
  const weeks = Math.max(daysLeft, 7) / 7
  return {
    remaining,
    neededPerWeek: remaining > 0 ? remaining / weeks : 0,
    overdue: daysLeft < 0 && remaining > 0,
  }
}

/** Format a required weekly pace (lb/week) for display, e.g. "2.5" or "<0.5". */
export function formatPace(perWeek: number): string {
  const r = Math.round(perWeek * 2) / 2
  return r < 0.5 ? '<0.5' : String(r)
}

export interface GoalProjection {
  /** Least-squares e1RM trend (lb/week); ≤0 means flat/declining. */
  slopePerWeek: number
  /** Projected date the trend reaches the target, or null if not trending up. */
  etaISO: string | null
  trendingUp: boolean
  /** Latest e1RM already meets/exceeds the target. */
  reached: boolean
}

/**
 * Project a goal ETA from logged e1RM over time: fit a least-squares line to the
 * dated e1RM points (the actual trend, NOT the required pace — that's
 * `requiredPace`) and extend from the latest session to the target. Returns no
 * date when there's <2 points, the trend is flat/down, or the goal is reached.
 * Points may be in any order; zero-e1RM sessions (e.g. bodyweight) are dropped.
 */
export function projectGoalEta(
  points: { date: string; e1rm: number }[],
  target: number,
): GoalProjection {
  const pts = points
    .filter((p) => p.e1rm > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  const last = pts[pts.length - 1]
  const reached = !!last && last.e1rm >= target
  if (pts.length < 2 || reached)
    return { slopePerWeek: 0, etaISO: null, trendingUp: false, reached }

  const base = pts[0].date
  const xs = pts.map((p) => daysBetweenISO(base, p.date))
  const ys = pts.map((p) => p.e1rm)
  const n = pts.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  const slopePerDay = den ? num / den : 0
  const slopePerWeek = slopePerDay * 7
  if (slopePerDay <= 0)
    return { slopePerWeek, etaISO: null, trendingUp: false, reached }

  // Anchor the projection at the latest actual e1RM (intuitive "from where you
  // are now"); the trend slope sets the pace. target > last.e1rm here, so days > 0.
  const days = Math.round((target - last.e1rm) / slopePerDay)
  return {
    slopePerWeek,
    etaISO: addDaysISO(last.date, days),
    trendingUp: true,
    reached,
  }
}

// --- Routine rotation ------------------------------------------------------

/** Pick the next template in a simple rotation. Given the routines in display
 *  order and workouts newest-first, find the most recent workout that came from
 *  a routine still in the list and return the *next* routine in order (wrapping
 *  around). Falls back to the first routine when nothing templated has been done
 *  yet, or the last one performed was an empty workout / a deleted template.
 *  Returns null only when there are no routines. */
export function nextRoutineId(
  routines: { id: string }[],
  workouts: { source_routine_id: string | null }[],
): string | null {
  if (routines.length === 0) return null
  const lastId = workouts.find(
    (w) =>
      w.source_routine_id && routines.some((r) => r.id === w.source_routine_id),
  )?.source_routine_id
  if (!lastId) return routines[0].id
  const i = routines.findIndex((r) => r.id === lastId)
  return routines[(i + 1) % routines.length].id
}

// --- Session length ----------------------------------------------------------

/** Minutes from a workout's creation to its last logged set. Null when there
 *  are no set timestamps or the span is non-positive. */
export function workoutDurationMin(
  workoutCreatedAt: string,
  setTimes: string[],
): number | null {
  if (!setTimes.length) return null
  const start = new Date(workoutCreatedAt).getTime()
  let end = -Infinity
  for (const t of setTimes) end = Math.max(end, new Date(t).getTime())
  const min = (end - start) / 60_000
  return min > 0 ? min : null
}

/** Typical session length for a routine, rounded to 5 min (min 5). Median of
 *  recent real durations, keeping only plausible ones (10 min – 3 h) so
 *  backfilled sessions and ones left open overnight don't skew it. With no
 *  usable history, falls back to ~3 min per template set (a missing
 *  target_sets counts as 3). Null when neither source has data. */
export function estimateRoutineMinutes(
  durationsMin: (number | null)[],
  targetSets: (number | null)[],
): number | null {
  const valid = durationsMin
    .filter((d): d is number => d != null && d >= 10 && d <= 180)
    .sort((a, b) => a - b)
  let est: number | null = null
  if (valid.length) {
    const mid = Math.floor(valid.length / 2)
    est = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2
  } else if (targetSets.length) {
    est = targetSets.reduce<number>((s, t) => s + (t ?? 3), 0) * 3
  }
  return est == null ? null : Math.max(5, Math.round(est / 5) * 5)
}
