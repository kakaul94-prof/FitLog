import type { DeloadState, NextOverride, ProgramItem } from './database.types'

// Sequential-rotation logic for the workout program. Pure + framework-free so
// it's unit-tested and shared by the Program page and the Exercise "Next up"
// card. "History" is the workouts list newest-first ({ id, source_routine_id }).
// Note: a routine appearing twice in one cycle isn't fully supported — indexOf
// finds the first occurrence, so rotation keys off that (v1 limitation).

/** Workout row shape the rotation reads; the list must be newest-first. */
export interface ProgramWorkoutRow {
  id: string
  source_routine_id: string | null
}

/** Ordered routine ids in the program, rest slots removed. */
export function programRoutineIds(sequence: ProgramItem[]): string[] {
  return sequence.flatMap((it) => (it.kind === 'routine' ? [it.routineId] : []))
}

/** Most recent workout that came from a template still in the program. */
export function latestProgramWorkout(
  routineIds: string[],
  workouts: ProgramWorkoutRow[],
): ProgramWorkoutRow | null {
  const inProgram = new Set(routineIds)
  return (
    workouts.find(
      (w) => w.source_routine_id && inProgram.has(w.source_routine_id),
    ) ?? null
  )
}

/** The pinned routineId while the pin is live, else null. An object pin stays
 *  live exactly until any program workout is logged after it was set (its
 *  `sinceWorkoutId` marker stops matching the latest program workout) — so
 *  pinning the day you just did works, and a consumed pin never resurrects.
 *  A legacy bare-string pin (older saves) keeps the old rule: live only while
 *  it differs from the last-done routine. */
export function activeOverrideId(
  nextOverride: NextOverride | string | null | undefined,
  latest: ProgramWorkoutRow | null,
): string | null {
  if (!nextOverride) return null
  if (typeof nextOverride === 'string')
    return nextOverride !== (latest?.source_routine_id ?? null)
      ? nextOverride
      : null
  return nextOverride.sinceWorkoutId === (latest?.id ?? null)
    ? nextOverride.routineId
    : null
}

/** Next template to train: a live pin wins; otherwise the routine after your
 *  most recently trained one, wrapping around, skipping rest days.
 *  Returns null only when the program has no templates. */
export function nextProgramRoutineId(
  sequence: ProgramItem[],
  workouts: ProgramWorkoutRow[],
  nextOverride?: NextOverride | string | null,
): string | null {
  const ids = programRoutineIds(sequence)
  if (ids.length === 0) return null
  const latest = latestProgramWorkout(ids, workouts)
  const pinned = activeOverrideId(nextOverride, latest)
  if (pinned && ids.includes(pinned)) return pinned
  const last = latest?.source_routine_id ?? null
  if (!last) return ids[0]
  const i = ids.indexOf(last)
  return ids[(i + 1) % ids.length]
}

/** Index in `sequence` of the current day (most recently trained template), for
 *  a "day X of N" readout. -1 when nothing in the program has been done. */
export function currentProgramIndex(
  sequence: ProgramItem[],
  workouts: ProgramWorkoutRow[],
): number {
  const last = latestProgramWorkout(programRoutineIds(sequence), workouts)
    ?.source_routine_id
  if (!last) return -1
  return sequence.findIndex(
    (it) => it.kind === 'routine' && it.routineId === last,
  )
}

/** The next `count` templates in order (skipping rest, wrapping), starting at
 *  nextProgramRoutineId — for the "upcoming" preview. */
export function upcomingProgramRoutineIds(
  sequence: ProgramItem[],
  workouts: ProgramWorkoutRow[],
  nextOverride: NextOverride | string | null | undefined,
  count: number,
): string[] {
  const ids = programRoutineIds(sequence)
  if (ids.length === 0 || count <= 0) return []
  const first = nextProgramRoutineId(sequence, workouts, nextOverride)
  if (!first) return []
  const start = ids.indexOf(first)
  return Array.from({ length: count }, (_, k) => ids[(start + k) % ids.length])
}

export interface CycleCounts {
  length: number
  lifts: number
  rests: number
}
/** Composition of the cycle: total slots, template days, rest days. */
export function cycleCounts(sequence: ProgramItem[]): CycleCounts {
  const rests = sequence.filter((it) => it.kind === 'rest').length
  return { length: sequence.length, lifts: sequence.length - rests, rests }
}

// --- Deload ---------------------------------------------------------------
// A deload is a manually-started "lighter" cycle: advisory only (a banner + a
// reduced planned-volume readout), it never changes what you actually log.

/** Aim for this fraction of normal volume during a deload (display-only guide). */
export const DELOAD_VOLUME_FACTOR = 0.5

/** How many workouts in `workouts` came from a template in the program. Note:
 *  reads the loaded (recent) history, so it's approximate for very long logs. */
export function programWorkoutCount(
  routineIds: string[],
  workouts: { source_routine_id: string | null }[],
): number {
  const inProgram = new Set(routineIds)
  return workouts.filter(
    (w) => w.source_routine_id && inProgram.has(w.source_routine_id),
  ).length
}

/** Whether a manually-started deload is still running: it stays active until one
 *  cycle's worth of program workouts have been logged since it began, then
 *  auto-ends. `liftsPerCycle` is cycleCounts(sequence).lifts. */
export function deloadActive(
  deload: DeloadState | null | undefined,
  routineIds: string[],
  workouts: { source_routine_id: string | null }[],
  liftsPerCycle: number,
): boolean {
  if (!deload || liftsPerCycle <= 0) return false
  const done =
    programWorkoutCount(routineIds, workouts) - deload.startProgramWorkouts
  return done < liftsPerCycle
}
