// Pure logic behind "Save changes to <template>?" on the workout Done button:
// turn a logged workout into template rows, diff those against the source
// template, and merge them back without touching the template's warm-up or
// cardio rows (which never become workout exercises).

import { isCardioKey } from './cardio'
import { isLiftKey, isWarmupKey } from './warmup'

/** Column default on routines.rest_seconds / workouts.rest_seconds. */
export const DEFAULT_REST_SECONDS = 90

/** The subset of a routine_exercises row the diff + merge care about. */
export interface TemplateRow {
  exercise_key: string
  exercise_name: string
  target_sets: number | null
  target_reps: number | null
  superset_group: number | null
  is_optional?: boolean | null
  target_duration_min?: number | null
  target_distance_mi?: number | null
  target_zone?: number | null
  intervals?: unknown
}

export interface LoggedExercise {
  id: string
  exercise_key: string
  exercise_name: string
  position: number
  superset_group: number | null
}

export interface LoggedSet {
  workout_exercise_id: string | null
  reps: number | null
  weight_lb: number | null
  is_warmup?: boolean | null
}

const setLogged = (s: LoggedSet) => s.reps != null || s.weight_lb != null

/** Most frequent value; ties go to the one logged first. null when empty. */
function mode(values: number[]): number | null {
  if (values.length === 0) return null
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | null = null
  let bestN = 0
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v
      bestN = n
    }
  }
  return best
}

/**
 * Template rows for a workout's exercises, in workout order. Target sets = the
 * sets you actually logged (warm-up sets excluded; an exercise with nothing
 * logged keeps its blank set rows as the count, min 1). Target reps = the reps
 * you logged most often, or null when none were.
 */
export function liftsFromWorkout(
  exercises: LoggedExercise[],
  sets: LoggedSet[],
): TemplateRow[] {
  return [...exercises]
    .sort((a, b) => a.position - b.position)
    .map((ex) => {
      const mine = sets.filter(
        (s) => s.workout_exercise_id === ex.id && !s.is_warmup,
      )
      const logged = mine.filter(setLogged)
      const count = logged.length > 0 ? logged.length : mine.length
      return {
        exercise_key: ex.exercise_key,
        exercise_name: ex.exercise_name,
        target_sets: Math.max(1, count),
        target_reps: mode(
          logged.map((s) => s.reps).filter((r): r is number => r != null),
        ),
        superset_group: ex.superset_group,
      }
    })
}

export interface TemplateDiff {
  /** Exercise names in the workout but not the template. */
  added: string[]
  /** Exercise names in the template but not the workout. */
  removed: string[]
  /** Exercises in both whose set target would change (template had a target). */
  sets: { name: string; from: number; to: number }[]
  /** Shared exercises appear in a different relative order. */
  reordered: boolean
  rest: { from: number; to: number } | null
  /** Anything above is non-empty — the Done sheet is worth showing. */
  changed: boolean
}

/**
 * What "Update template" would change. Only lift rows take part: warm-up and
 * cardio rows live on the template alone. A template row with no set target
 * never reports a set change (nothing to compare), though the update still
 * writes the logged count.
 */
export function diffTemplate(
  template: TemplateRow[],
  workout: TemplateRow[],
  templateRest: number,
  workoutRest: number,
): TemplateDiff {
  const tLifts = template.filter((r) => isLiftKey(r.exercise_key))
  const tKeys = new Map(tLifts.map((r) => [r.exercise_key, r]))
  const wKeys = new Map(workout.map((r) => [r.exercise_key, r]))

  const added = workout
    .filter((r) => !tKeys.has(r.exercise_key))
    .map((r) => r.exercise_name)
  const removed = tLifts
    .filter((r) => !wKeys.has(r.exercise_key))
    .map((r) => r.exercise_name)

  const sets: TemplateDiff['sets'] = []
  for (const w of workout) {
    const t = tKeys.get(w.exercise_key)
    if (!t || t.target_sets == null || w.target_sets == null) continue
    if (t.target_sets !== w.target_sets)
      sets.push({ name: w.exercise_name, from: t.target_sets, to: w.target_sets })
  }

  const sharedT = tLifts
    .filter((r) => wKeys.has(r.exercise_key))
    .map((r) => r.exercise_key)
  const sharedW = workout
    .filter((r) => tKeys.has(r.exercise_key))
    .map((r) => r.exercise_key)
  const reordered = sharedT.some((k, i) => sharedW[i] !== k)

  const rest =
    templateRest !== workoutRest ? { from: templateRest, to: workoutRest } : null

  return {
    added,
    removed,
    sets,
    reordered,
    rest,
    changed:
      added.length > 0 ||
      removed.length > 0 ||
      sets.length > 0 ||
      reordered ||
      rest != null,
  }
}

/**
 * The template's new row list after taking a workout's lifts: warm-up rows
 * first (as the editor saves them), then the workout's lifts in workout order,
 * then the template's cardio rows. A lift that was already on the template
 * keeps its time-budget `is_optional` flag.
 */
export function mergeTemplateRows<T extends TemplateRow>(
  existing: T[],
  workout: TemplateRow[],
): TemplateRow[] {
  const byKey = new Map(existing.map((r) => [r.exercise_key, r]))
  return [
    ...existing.filter((r) => isWarmupKey(r.exercise_key)),
    ...workout.map((w) => ({
      ...w,
      is_optional: byKey.get(w.exercise_key)?.is_optional ?? false,
    })),
    ...existing.filter((r) => isCardioKey(r.exercise_key)),
  ]
}

/** "2:30" — shared by the Done sheet and the template editor. */
export const fmtRest = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
