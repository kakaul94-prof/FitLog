import { estimated1RM } from './calc'
import type { ProgressionMethod, StrengthGoal } from './database.types'

// A past set for one exercise. Sessions are arrays of these, newest session
// first; weight/reps may be null (blank prefill rows are filtered out here).
export interface PriorSet {
  weight_lb: number | null
  reps: number | null
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

// The top working weight of a session + the (min) reps and set count at it.
function sessionTop(
  sets: PriorSet[],
): { topWeight: number; reps: number; count: number } | null {
  const w = working(sets)
  if (!w.length) return null
  const topWeight = Math.max(...w.map((s) => s.weight_lb as number))
  const atTop = w.filter((s) => s.weight_lb === topWeight)
  const reps = Math.min(...atTop.map((s) => s.reps as number))
  return { topWeight, reps, count: atTop.length }
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
  if (hit) {
    weight = round5(last.topWeight + inc)
    reps = bottomReps
    action = 'increase'
    rationale = `You hit ${last.count}×${last.reps} at ${last.topWeight} lb — go up ${inc} lb.`
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
    source,
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
