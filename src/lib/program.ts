import type { DeloadState, ProgramItem } from './database.types'

// Sequential-rotation logic for the workout program. Pure + framework-free so
// it's unit-tested and shared by the Program page and the Exercise "Next up"
// card. "History" is the workouts list newest-first ({ source_routine_id }).
// Note: a routine appearing twice in one cycle isn't fully supported — indexOf
// finds the first occurrence, so rotation keys off that (v1 limitation).

/** Ordered routine ids in the program, rest slots removed. */
export function programRoutineIds(sequence: ProgramItem[]): string[] {
  return sequence.flatMap((it) => (it.kind === 'routine' ? [it.routineId] : []))
}

/** Most recent workout that came from a template still in the program. */
function lastDoneRoutineId(
  routineIds: string[],
  workouts: { source_routine_id: string | null }[],
): string | null {
  const inProgram = new Set(routineIds)
  return (
    workouts.find(
      (w) => w.source_routine_id && inProgram.has(w.source_routine_id),
    )?.source_routine_id ?? null
  )
}

/** Next template to train: the routine after your most recently trained one,
 *  wrapping around, skipping rest days. A fresh `nextOverride` wins until it's
 *  actually been trained (then it's "consumed" and we resume from history).
 *  Returns null only when the program has no templates. */
export function nextProgramRoutineId(
  sequence: ProgramItem[],
  workouts: { source_routine_id: string | null }[],
  nextOverride?: string | null,
): string | null {
  const ids = programRoutineIds(sequence)
  if (ids.length === 0) return null
  const last = lastDoneRoutineId(ids, workouts)
  if (nextOverride && nextOverride !== last && ids.includes(nextOverride))
    return nextOverride
  if (!last) return ids[0]
  const i = ids.indexOf(last)
  return ids[(i + 1) % ids.length]
}

/** Index in `sequence` of the current day (most recently trained template), for
 *  a "day X of N" readout. -1 when nothing in the program has been done. */
export function currentProgramIndex(
  sequence: ProgramItem[],
  workouts: { source_routine_id: string | null }[],
): number {
  const last = lastDoneRoutineId(programRoutineIds(sequence), workouts)
  if (!last) return -1
  return sequence.findIndex(
    (it) => it.kind === 'routine' && it.routineId === last,
  )
}

/** The next `count` templates in order (skipping rest, wrapping), starting at
 *  nextProgramRoutineId — for the "upcoming" preview. */
export function upcomingProgramRoutineIds(
  sequence: ProgramItem[],
  workouts: { source_routine_id: string | null }[],
  nextOverride: string | null | undefined,
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
