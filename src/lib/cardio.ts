// Cardio-in-templates domain logic: the 'cardio:<activity_key>' routine-item
// convention, prescription labels, completion matching, pace, and the weekly
// volume window. Pure — UI + hooks live in the pages/features that import this.
import { ACTIVITIES, RECORDER_ACTIVITIES } from '@/data/activities'
import type { CustomActivity, IntervalsTarget } from './database.types'
import { addDaysISO } from './date'

/** routine_exercises.exercise_key prefix marking a cardio item. */
export const CARDIO_PREFIX = 'cardio:'

export const isCardioKey = (key: string): boolean =>
  key.startsWith(CARDIO_PREFIX)

/** The activity key inside a 'cardio:<activity_key>' routine item. */
export const cardioActivityKey = (key: string): string =>
  key.slice(CARDIO_PREFIX.length)

/** GPS-recorder activities are recorded (ExerciseTrackPage), not hand-logged. */
export const isRecorderActivity = (activityKey: string): boolean =>
  RECORDER_ACTIVITIES.some((a) => a.key === activityKey)

export interface CardioActivityInfo {
  key: string
  name: string
  met: number
  distanceBased: boolean
  recorder: boolean
}

/** Every activity a cardio template item can point at: GPS-recorder entries
 *  first, then the manual catalog, then the user's custom activities. */
export function allCardioActivities(
  custom: CustomActivity[] = [],
): CardioActivityInfo[] {
  return [
    ...RECORDER_ACTIVITIES.map((a) => ({
      key: a.key,
      name: a.name,
      met: a.met,
      distanceBased: a.distanceBased,
      recorder: true,
    })),
    ...ACTIVITIES.map((a) => ({
      key: a.key,
      name: a.name,
      met: a.met,
      distanceBased: a.distanceBased,
      recorder: false,
    })),
    ...custom.map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      met: c.met,
      distanceBased: c.distance_based,
      recorder: false,
    })),
  ]
}

/** Look up a cardio item's activity by its (unprefixed) activity key. Null when
 *  it no longer exists (e.g. a deleted custom activity). */
export function findCardioActivity(
  activityKey: string,
  custom: CustomActivity[] = [],
): CardioActivityInfo | null {
  return (
    allCardioActivities(custom).find((a) => a.key === activityKey) ?? null
  )
}

/** Seconds as m:ss, e.g. 90 → "1:30", 45 → "0:45". */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** "6 × 1:00 / 2:00" (rounds × work / rest). */
export const intervalsLabel = (iv: IntervalsTarget): string =>
  `${iv.rounds} × ${fmtClock(iv.workSec)} / ${fmtClock(iv.restSec)}`

/** Decimal minutes per mile, or null when either side is missing. */
export function paceMinPerMi(
  durationMin: number | null | undefined,
  distanceMi: number | null | undefined,
): number | null {
  if (!durationMin || !distanceMi || durationMin <= 0 || distanceMi <= 0)
    return null
  return durationMin / distanceMi
}

/** Decimal min/mi as "m:ss /mi", e.g. 10.5 → "10:30 /mi". */
export function paceLabel(minPerMi: number): string {
  return `${fmtClock(minPerMi * 60)} /mi`
}

export interface CardioTargets {
  target_duration_min: number | null
  target_distance_mi: number | null
  target_zone: number | null
  intervals: IntervalsTarget | null
}

/** Prescription chips in display order: duration · distance · (pace) · zone ·
 *  intervals. Empty when the item has no targets ("just do it"). */
export function cardioTargetChips(t: CardioTargets): string[] {
  const chips: string[] = []
  if (t.target_duration_min) chips.push(`${t.target_duration_min} min`)
  if (t.target_distance_mi) chips.push(`${t.target_distance_mi} mi`)
  const pace = paceMinPerMi(t.target_duration_min, t.target_distance_mi)
  if (pace != null) chips.push(paceLabel(pace))
  if (t.target_zone) chips.push(`Zone ${t.target_zone}`)
  if (t.intervals) chips.push(intervalsLabel(t.intervals))
  return chips
}

/** Does a logged cardio entry count as this template item? Entries don't store
 *  an activity key, so match on the activity name (what the log form saves). */
export const entryMatchesCardio = (
  itemName: string,
  entryName: string,
): boolean => itemName.trim().toLowerCase() === entryName.trim().toLowerCase()

/** Monday of the ISO week containing `iso` — the "this week" window start. */
export function weekStartISO(iso: string): string {
  const dow = new Date(iso + 'T00:00:00').getDay() // 0 = Sun … 6 = Sat
  return addDaysISO(iso, -((dow + 6) % 7))
}

/** Total cardio minutes across entries (missing durations count 0). */
export const sumCardioMinutes = (
  entries: { duration_min: number | null }[],
): number => Math.round(entries.reduce((s, e) => s + (e.duration_min ?? 0), 0))
