import { REGION_IDS, REGION_LABEL, resolveContrib, type RegionId } from '@/data/bodyMap'
import { PAIN_SITES, formatPain } from './rehab'
import { loadsFor } from './checkin'
import { daysBetweenISO, todayISO } from './date'
import type { RecoveryAnswer, WorkoutCheckin } from './database.types'

// Next-day recovery: how a recent workout landed — the main muscles it worked
// and the joints it loaded. Asked by the 9:00 notification ("morning") and
// again at the next start ("pre"); both answers are kept on that workout's own
// checkin.after. Pure, so it's unit-tested.

export interface Lift {
  key: string
  name: string
}

/** A workout is "last workout" material for this long after it. */
export const RECENT_DAYS = 3

/** Main muscles only — regions an exercise works at full weight (1), in the
 *  heatmap's own order. */
export function musclesWorked(
  lifts: Lift[],
  customTag: Map<string, string | null>,
): RegionId[] {
  const hit = new Set<RegionId>()
  for (const l of lifts) {
    const c = resolveContrib(l.key, l.name, customTag) ?? {}
    for (const [r, w] of Object.entries(c)) if ((w ?? 0) >= 1) hit.add(r as RegionId)
  }
  return REGION_IDS.filter((r) => hit.has(r))
}

/** Joints the lifts load (from data/jointStress.ts), in PAIN_SITES order. */
export function jointsLoaded(lifts: Lift[]): string[] {
  const hit = new Set(lifts.flatMap((l) => loadsFor(l.key, l.name) ?? []))
  return PAIN_SITES.filter((s) => hit.has(s))
}

export const isRecent = (workoutDate: string, today: string) => {
  const d = daysBetweenISO(workoutDate, today)
  return d >= 0 && d < RECENT_DAYS
}

/** The 9:00 answer was given today (local) — the start sheet then skips the
 *  last workout and asks only about the joints today loads. */
export const answeredToday = (a: RecoveryAnswer | undefined, today: string) =>
  !!a && todayISO(new Date(a.at)) === today

/** "yesterday", "2 days ago" — the recovery sheet's subtitle. */
export function agoLabel(workoutDate: string, today: string): string {
  const d = daysBetweenISO(workoutDate, today)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** 9:00 local the day after the workout — when the recovery question fires. */
export function nextMorning9(workoutDate: string): Date {
  const [y, m, d] = workoutDate.split('-').map(Number)
  return new Date(y, m - 1, d + 1, 9, 0, 0)
}

/** Lifts today that work a muscle answered very sore or sharp → "go lighter". */
export function sorenessHeadsUp(
  lifts: Lift[],
  answer: Pick<RecoveryAnswer, 'muscles'>,
  customTag: Map<string, string | null>,
): { lift: string; regions: string[] }[] {
  const bad = Object.entries(answer.muscles)
    .filter(([, m]) => m.feel === 'very_sore' || m.feel === 'sharp')
    .map(([r]) => r)
  if (!bad.length) return []
  return lifts
    .map((l) => ({
      lift: l.name,
      regions: musclesWorked([l], customTag)
        .filter((r) => bad.includes(r))
        .map((r) => REGION_LABEL[r].toLowerCase()),
    }))
    .filter((h) => h.regions.length)
}

/** Write one recovery answer onto a workout's checkin, keeping the other slot
 *  and whatever its own pre-workout check-in recorded. */
export function withRecovery(
  c: WorkoutCheckin | null | undefined,
  slot: 'morning' | 'pre',
  answer: RecoveryAnswer,
): WorkoutCheckin {
  const base = c ?? { flags: [], swaps: [], skipped: [] }
  return { ...base, after: { ...base.after, [slot]: answer } }
}

const FEEL_LABEL: Record<string, string> = {
  sore: 'sore',
  very_sore: 'very sore',
  achy: 'achy',
  sharp: 'sharp pain',
}

/** Non-fine rows only — "quads very sore, left shoulder sharp pain". */
export function answerLabel(a: RecoveryAnswer): string {
  const rows = [
    ...Object.entries(a.muscles).map(([r, m]) => ({
      what: REGION_LABEL[r as RegionId]?.toLowerCase() ?? r,
      ...m,
    })),
    ...Object.entries(a.joints).map(([s, j]) => ({ what: s, ...j })),
  ].filter((x) => x.feel !== 'fine')
  return rows.length
    ? rows.map((x) => `${formatPain(x.what, x.side ?? null)} ${FEEL_LABEL[x.feel]}`).join(', ')
    : 'all fine'
}

/** "next morning: quads sore; before next workout: all fine" for the trainer. */
export function recoverySummary(after: WorkoutCheckin['after']): string {
  if (!after) return ''
  const parts: string[] = []
  if (after.morning) parts.push(`next morning: ${answerLabel(after.morning)}`)
  if (after.pre) parts.push(`before next workout: ${answerLabel(after.pre)}`)
  return parts.join('; ')
}
