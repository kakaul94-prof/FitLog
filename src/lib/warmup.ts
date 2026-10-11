// Template warm-ups: the 'warmup:<drill_key>' routine-item convention, the
// "suggest from my lifts" picker, and banking ticked drills into the Mobility
// list. Pure — the editor, the workout checklist and the hook import this.
import { WARMUP_DRILLS, findWarmupDrill, type WarmupTag } from '@/data/warmupDrills'
import { isCardioKey } from './cardio'
import { pruneMobilityLog } from './mobility'
import type { MobilityState } from './database.types'

/** routine_exercises.exercise_key prefix marking a warm-up drill. Like cardio
 *  items, these never become workout exercises. */
export const WARMUP_PREFIX = 'warmup:'

export const isWarmupKey = (key: string): boolean => key.startsWith(WARMUP_PREFIX)

export const warmupDrillKey = (key: string): string => key.slice(WARMUP_PREFIX.length)

/** A template row that is an actual lift (not cardio, not a warm-up drill). */
export const isLiftKey = (key: string): boolean => !isCardioKey(key) && !isWarmupKey(key)

const MUSCLE_TAGS: Record<string, WarmupTag[]> = {
  legs: ['ankle', 'hip'],
  quads: ['ankle', 'hip'],
  calves: ['ankle'],
  glutes: ['hip'],
  hips: ['hip'],
  'hip flexors': ['hip'],
  adductors: ['hip'],
  hamstrings: ['hamstring', 'hip'],
  chest: ['shoulder', 'tspine'],
  shoulders: ['shoulder', 'scap'],
  'rear delts': ['scap', 'shoulder'],
  triceps: ['shoulder'],
  back: ['scap', 'tspine'],
  lats: ['scap', 'shoulder'],
  'upper back': ['scap', 'tspine'],
  biceps: ['wrist'],
  forearms: ['wrist'],
  core: ['core'],
  spine: ['tspine', 'core'],
  'full body': ['hip', 'tspine', 'shoulder'],
}

// Hinges are filed under Back/Glutes but load the hamstrings and hips.
const HINGE = /deadlift|\brdl\b|good morning|hip thrust|swing/i

/** Joint areas a lift needs warmed up, from its muscle (plus a hinge check on
 *  the name). Unknown muscles get nothing rather than a guess. */
export function liftTags(name: string, muscle: string | null | undefined): WarmupTag[] {
  const tags = new Set(MUSCLE_TAGS[(muscle ?? '').trim().toLowerCase()] ?? [])
  if (HINGE.test(name)) {
    tags.add('hamstring')
    tags.add('hip')
  }
  return [...tags]
}

export const WARMUP_MIN = 3
export const WARMUP_MAX = 5

/** Pick 3–5 drills covering what the lifts need. Greedy: each pick is the drill
 *  that covers the most still-uncovered need (weighted by how many lifts share
 *  it); once everything is covered it tops up to WARMUP_MIN by overall fit.
 *  Ties go to library order. Returns drill keys; empty when no lift maps. */
export function suggestWarmup(
  lifts: { name: string; muscle: string | null | undefined }[],
): string[] {
  const need = new Map<WarmupTag, number>()
  for (const l of lifts)
    for (const t of liftTags(l.name, l.muscle)) need.set(t, (need.get(t) ?? 0) + 1)
  if (need.size === 0) return []

  const covered = new Set<WarmupTag>()
  const picked: string[] = []
  while (picked.length < WARMUP_MAX) {
    const score = (tags: WarmupTag[], fresh: boolean) =>
      tags.reduce((s, t) => s + (fresh && covered.has(t) ? 0 : (need.get(t) ?? 0)), 0)
    const fresh = [...need.keys()].some((t) => !covered.has(t))
    if (!fresh && picked.length >= WARMUP_MIN) break
    let best: (typeof WARMUP_DRILLS)[number] | null = null
    let bestScore = 0
    for (const d of WARMUP_DRILLS) {
      if (picked.includes(d.key)) continue
      const s = score(d.tags, fresh)
      if (s > bestScore) {
        best = d
        bestScore = s
      }
    }
    if (!best) break
    picked.push(best.key)
    for (const t of best.tags) covered.add(t)
  }
  return picked
}

/** Estimated seconds for a list of drill keys (unknown keys count 0). */
export const warmupEstSec = (drillKeys: string[]): number =>
  drillKeys.reduce((s, k) => s + (findWarmupDrill(k)?.estSec ?? 0), 0)

// ── Banking into the Mobility list ──────────────────────────────────────────

/** Name + weekly target of the Mobility item that warm-ups bank into. */
export const WARMUP_STRETCH_NAME = 'Warm-up'
export const WARMUP_STRETCH_TARGET_MIN = 20

/** The Mobility item warm-ups bank into, created on first use. */
export function ensureWarmupStretch(
  state: MobilityState,
  newId: string,
): { state: MobilityState; stretchId: string } {
  const existing = state.stretches.find((s) => s.warmup)
  if (existing) return { state, stretchId: existing.id }
  return {
    state: {
      ...state,
      stretches: [
        ...state.stretches,
        { id: newId, name: WARMUP_STRETCH_NAME, targetMin: WARMUP_STRETCH_TARGET_MIN, warmup: true },
      ],
    },
    stretchId: newId,
  }
}

/** Seconds banked per drill for one workout — doubles as its tick state. */
export function tickedDrills(state: MobilityState, workoutId: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of state.log)
    if (e.workoutId === workoutId && e.drill) m.set(e.drill, (m.get(e.drill) ?? 0) + e.seconds)
  return m
}

/** Tick a drill: bank its time against the Warm-up item (created if missing).
 *  Ticking an already-ticked drill is a no-op, so a double tap can't double-bank. */
export function tickWarmup(
  state: MobilityState,
  t: { workoutId: string; drill: string; date: string; seconds: number; id: string; stretchId: string },
): MobilityState {
  if (tickedDrills(state, t.workoutId).has(t.drill)) return state
  const ensured = ensureWarmupStretch(state, t.stretchId)
  const seconds = Math.max(1, Math.round(t.seconds))
  return {
    ...ensured.state,
    log: pruneMobilityLog(
      [
        ...ensured.state.log,
        { id: t.id, stretchId: ensured.stretchId, date: t.date, seconds, workoutId: t.workoutId, drill: t.drill },
      ],
      t.date,
    ),
  }
}

/** Untick a drill, taking its banked time back out. */
export const untickWarmup = (
  state: MobilityState,
  workoutId: string,
  drill: string,
): MobilityState => ({
  ...state,
  log: state.log.filter((e) => !(e.workoutId === workoutId && e.drill === drill)),
})
