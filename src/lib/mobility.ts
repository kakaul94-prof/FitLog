import type {
  MobilityLogEntry,
  MobilityState,
  MobilityStretch,
} from './database.types'
import { weekStartISO } from './cardio'
import { addDaysISO, daysBetweenISO } from './date'

// Mobility list logic: weekly minute targets you bank a few minutes at a time,
// rather than a session you complete in one go. Pure + framework-free so it's
// unit-tested and shared by the Program page's Mobility section and its timer.
// Time is stored in seconds and rounded to minutes only for display.

/** Weeks of banked time kept in the profile jsonb; older entries are dropped on
 *  save so the blob stays small (the UI only ever shows the current week). */
export const MOBILITY_LOG_WEEKS = 8

export const emptyMobility = (): MobilityState => ({ stretches: [], log: [] })

/** Minutes → a compact label. Sub-minute time reads in seconds so a 40s hold
 *  doesn't display as "0 min". */
export function minLabel(seconds: number): string {
  if (seconds <= 0) return '0 min'
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.round(seconds / 60)} min`
}

/** Seconds → "m:ss" for the running timer. */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Entries banked in the week starting `weekStart` (Monday, from weekStartISO). */
export function entriesInWeek(
  log: MobilityLogEntry[],
  weekStart: string,
): MobilityLogEntry[] {
  const end = addDaysISO(weekStart, 7)
  return log.filter((e) => e.date >= weekStart && e.date < end)
}

/** Banked seconds per stretch id for the given week. */
export function bankedByStretch(
  log: MobilityLogEntry[],
  weekStart: string,
): Map<string, number> {
  const by = new Map<string, number>()
  for (const e of entriesInWeek(log, weekStart))
    by.set(e.stretchId, (by.get(e.stretchId) ?? 0) + e.seconds)
  return by
}

export interface MobilityRow {
  stretch: MobilityStretch
  /** Seconds banked this week. */
  banked: number
  /** Weekly target in seconds (0 when the stretch has no target). */
  target: number
  /** 0–1, clamped; 1 when the target is met (or when there is no target). */
  progress: number
  done: boolean
}

export interface MobilityWeek {
  rows: MobilityRow[]
  bankedSec: number
  targetSec: number
  /** 0–1 across the whole list, clamped. */
  progress: number
  doneCount: number
  /** Days remaining in the week, counting today (Monday 7 … Sunday 1). */
  daysLeft: number
}

/** Roll the list up for one week: per-stretch progress plus the header totals. */
export function mobilityWeek(
  state: MobilityState | null | undefined,
  today: string,
): MobilityWeek {
  const weekStart = weekStartISO(today)
  const stretches = state?.stretches ?? []
  const by = bankedByStretch(state?.log ?? [], weekStart)
  const rows: MobilityRow[] = stretches.map((stretch) => {
    const banked = by.get(stretch.id) ?? 0
    const target = Math.max(0, stretch.targetMin) * 60
    const progress = target > 0 ? Math.min(1, banked / target) : banked > 0 ? 1 : 0
    return { stretch, banked, target, progress, done: target > 0 && banked >= target }
  })
  const bankedSec = rows.reduce((s, r) => s + r.banked, 0)
  const targetSec = rows.reduce((s, r) => s + r.target, 0)
  return {
    rows,
    bankedSec,
    targetSec,
    progress: targetSec > 0 ? Math.min(1, bankedSec / targetSec) : 0,
    doneCount: rows.filter((r) => r.done).length,
    daysLeft: 7 - daysBetweenISO(weekStart, today),
  }
}

/** Drop entries older than MOBILITY_LOG_WEEKS whole weeks. */
export function pruneMobilityLog(
  log: MobilityLogEntry[],
  today: string,
): MobilityLogEntry[] {
  const cutoff = addDaysISO(weekStartISO(today), -7 * (MOBILITY_LOG_WEEKS - 1))
  return log.filter((e) => e.date >= cutoff)
}

/** Bank time against a stretch, returning a new state (log pruned). Sub-second
 *  and negative amounts are ignored so a mis-tapped timer can't log noise. */
export function bankSeconds(
  state: MobilityState,
  stretchId: string,
  date: string,
  seconds: number,
  id: string,
): MobilityState {
  const s = Math.round(seconds)
  if (s < 1) return state
  return {
    ...state,
    log: pruneMobilityLog([...state.log, { id, stretchId, date, seconds: s }], date),
  }
}

/** Banked seconds per day for one stretch this week, oldest first — the
 *  "this week" breakdown under the timer. */
export function stretchWeekByDay(
  log: MobilityLogEntry[],
  stretchId: string,
  weekStart: string,
): { date: string; seconds: number }[] {
  const by = new Map<string, number>()
  for (const e of entriesInWeek(log, weekStart)) {
    if (e.stretchId !== stretchId) continue
    by.set(e.date, (by.get(e.date) ?? 0) + e.seconds)
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, seconds]) => ({ date, seconds }))
}
