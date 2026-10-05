import type {
  Injury,
  RehabCheckin,
  RehabLogEntry,
  RehabPlanItem,
  RehabState,
  BodySide,
} from './database.types'
import { weekStartISO } from './cardio'
import { addDaysISO, daysBetweenISO } from './date'

// Rehab logic: an injury you open, work at a few times a week, rate now and
// then, and close when it's better. Pure + framework-free so it's unit-tested
// and shared by the rehab pages and the in-workout warning.
//
// Deliberately NOT modelled on workouts: rehab work is low-load and daily-ish,
// and routing it through workout_sets would feed the volume heatmap and muscle
// targets with band work. It gets its own log, the same call Mobility made.

/** Pain sites, matching the chips on the workout page. */
export const PAIN_SITES = [
  'shoulder',
  'elbow',
  'wrist',
  'low back',
  'hip',
  'knee',
  'other',
]

/** Sites that come in pairs, so a flag is worth a side. 'low back' and 'other'
 *  are deliberately absent — asking L/R there is noise. */
export const PAIRED_SITES = ['shoulder', 'elbow', 'wrist', 'hip', 'knee']

const SIDES: Exclude<BodySide, null>[] = ['left', 'right', 'both']

export const isPaired = (site: string) => PAIRED_SITES.includes(site)

/** Weeks of rehab log kept in the profile jsonb. A recovery arc runs months,
 *  not the 8 weeks Mobility keeps, and the entries are tiny. */
export const REHAB_LOG_WEEKS = 52

export const emptyRehab = (): RehabState => ({
  injuries: [],
  log: [],
  checkins: [],
})

/** Split a stored pain value into site + side. Rows logged before sides existed
 *  carry no prefix and read back as `side: null` — "not recorded", not "both". */
export function parsePain(raw: string): { site: string; side: BodySide } {
  const v = raw.trim().toLowerCase()
  for (const side of SIDES) {
    if (v.startsWith(side + ' ')) return { site: v.slice(side.length + 1), side }
  }
  return { site: v, side: null }
}

/** Site + side → the value stored in workout_sets.pain. */
export function formatPain(site: string, side: BodySide): string {
  return side ? `${side} ${site}` : site
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Display label for a stored pain value ('left shoulder' → 'Left shoulder'). */
export const painLabel = (raw: string) => cap(raw)

/** Display name for an injury ('Left shoulder', 'Low back'). */
export function injuryLabel(inj: Injury): string {
  return cap(formatPain(inj.site, inj.side))
}

/** Days the injury has been open (or ran, once resolved). Day 1 = the start
 *  date itself, so a brand-new injury doesn't read as "day 0". */
export function injuryDay(inj: Injury, today: string): number {
  const end = inj.status === 'resolved' && inj.resolved ? inj.resolved : today
  return Math.max(1, daysBetweenISO(inj.started, end) + 1)
}

/** Does this pain flag belong to this injury? A side-less flag counts for an
 *  injury on either side — it's the same joint, we just don't know which one.
 *  'both' matches anything on that site. */
export function painMatchesInjury(raw: string, inj: Injury): boolean {
  const { site, side } = parsePain(raw)
  if (site !== inj.site) return false
  if (side == null || inj.side == null) return true
  return side === 'both' || inj.side === 'both' || side === inj.side
}

// ---------------------------------------------------------------- plan + log

export interface RehabRow {
  item: RehabPlanItem
  /** Sessions logged this week. */
  done: number
  /** Sessions per week targeted (0 when untargeted). */
  target: number
  /** 0–1, clamped; 1 when there's no target to miss. */
  progress: number
  complete: boolean
}

export interface RehabWeek {
  rows: RehabRow[]
  doneCount: number
  targetCount: number
  /** 0–1 across the whole plan. */
  progress: number
}

/** Log entries for one injury in the week starting `weekStart` (Monday). */
export function entriesInWeek(
  log: RehabLogEntry[],
  injuryId: string,
  weekStart: string,
): RehabLogEntry[] {
  const end = addDaysISO(weekStart, 7)
  return log.filter(
    (e) => e.injuryId === injuryId && e.date >= weekStart && e.date < end,
  )
}

/** This week's progress across an injury's plan. */
export function rehabWeek(
  inj: Injury,
  log: RehabLogEntry[],
  today: string,
): RehabWeek {
  const weekStart = weekStartISO(today)
  const entries = entriesInWeek(log, inj.id, weekStart)
  const byItem = new Map<string, number>()
  for (const e of entries) byItem.set(e.itemId, (byItem.get(e.itemId) ?? 0) + 1)

  const rows: RehabRow[] = inj.plan.map((item) => {
    const done = byItem.get(item.id) ?? 0
    const target = Math.max(0, item.targetPerWeek)
    return {
      item,
      done,
      target,
      progress: target > 0 ? Math.min(1, done / target) : 1,
      complete: target > 0 ? done >= target : done > 0,
    }
  })

  const doneCount = rows.filter((r) => r.complete).length
  const targetCount = rows.length
  return {
    rows,
    doneCount,
    targetCount,
    progress: targetCount > 0 ? doneCount / targetCount : 0,
  }
}

/** Log one session of a plan item. */
export function logRehab(
  state: RehabState,
  injuryId: string,
  itemId: string,
  date: string,
  id: string,
  seconds?: number | null,
): RehabState {
  const entry: RehabLogEntry = { id, injuryId, itemId, date, seconds: seconds ?? null }
  return { ...state, log: pruneLog([...state.log, entry], date) }
}

/** Drop log entries older than REHAB_LOG_WEEKS so the jsonb blob stays small. */
export function pruneLog(log: RehabLogEntry[], today: string): RehabLogEntry[] {
  const cutoff = addDaysISO(weekStartISO(today), -7 * REHAB_LOG_WEEKS)
  return log.filter((e) => e.date >= cutoff)
}

// ------------------------------------------------------------------ check-ins

/** An injury's check-ins, oldest first. */
export function checkinsFor(
  checkins: RehabCheckin[],
  injuryId: string,
): RehabCheckin[] {
  return checkins
    .filter((c) => c.injuryId === injuryId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface PainTrend {
  points: RehabCheckin[]
  first: number | null
  latest: number | null
  /** latest − first; negative = improving. null when there's nothing to compare. */
  delta: number | null
  /** Days spanned by the check-ins. */
  days: number
}

export function painTrend(
  checkins: RehabCheckin[],
  injuryId: string,
): PainTrend {
  const points = checkinsFor(checkins, injuryId)
  if (points.length === 0)
    return { points, first: null, latest: null, delta: null, days: 0 }
  const first = points[0]
  const last = points[points.length - 1]
  return {
    points,
    first: first.pain,
    latest: last.pain,
    delta: points.length > 1 ? last.pain - first.pain : null,
    days: daysBetweenISO(first.date, last.date),
  }
}

/** Record today's rating, replacing an earlier one for the same day — the
 *  slider is a "how is it now", not a log of every time you poked it. */
export function recordCheckin(
  state: RehabState,
  injuryId: string,
  date: string,
  pain: number,
  id: string,
): RehabState {
  const clamped = Math.max(0, Math.min(10, Math.round(pain)))
  const rest = state.checkins.filter(
    (c) => !(c.injuryId === injuryId && c.date === date),
  )
  return { ...state, checkins: [...rest, { id, injuryId, date, pain: clamped }] }
}

// ------------------------------------------------------------- pain dashboard

export interface PainFlag {
  /** Raw stored value, e.g. 'left shoulder'. */
  pain: string
  date: string
  exerciseKey: string
  exerciseName: string
}

export interface SiteSummary {
  site: string
  count: number
  /** Counts by side; `unknown` = logged before sides were recorded. */
  left: number
  right: number
  both: number
  unknown: number
  /** Most recent flag on this site. */
  last: PainFlag
  /** Exercises that produced flags, most frequent first. */
  topExercises: { key: string; name: string; count: number }[]
}

/** Roll pain flags up per site, newest first by last occurrence. */
export function summarizeFlags(flags: PainFlag[]): SiteSummary[] {
  const bySite = new Map<string, PainFlag[]>()
  for (const f of flags) {
    const { site } = parsePain(f.pain)
    const arr = bySite.get(site) ?? []
    arr.push(f)
    bySite.set(site, arr)
  }

  const out: SiteSummary[] = []
  for (const [site, list] of bySite) {
    const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date))
    const byEx = new Map<string, { key: string; name: string; count: number }>()
    for (const f of list) {
      const e = byEx.get(f.exerciseKey) ?? {
        key: f.exerciseKey,
        name: f.exerciseName,
        count: 0,
      }
      e.count++
      byEx.set(f.exerciseKey, e)
    }
    const sides = { left: 0, right: 0, both: 0, unknown: 0 }
    for (const f of list) {
      const { side } = parsePain(f.pain)
      if (side === 'left') sides.left++
      else if (side === 'right') sides.right++
      else if (side === 'both') sides.both++
      else sides.unknown++
    }
    out.push({
      site,
      count: list.length,
      ...sides,
      last: sorted[0],
      topExercises: [...byEx.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 3),
    })
  }
  return out.sort(
    (a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date),
  )
}

/** Flags on this site within the last `days`, for an injury's own history. */
export function flagsForInjury(
  flags: PainFlag[],
  inj: Injury,
  today: string,
  days = 90,
): PainFlag[] {
  const cutoff = addDaysISO(today, -days)
  return flags
    .filter((f) => f.date >= cutoff && painMatchesInjury(f.pain, inj))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Open injuries that flag this exercise as aggravating — the pre-lift warning. */
export function injuriesWarningFor(
  state: RehabState,
  exerciseKey: string,
): Injury[] {
  return state.injuries.filter(
    (i) => i.status === 'active' && i.aggravates.includes(exerciseKey),
  )
}

export const activeInjuries = (s: RehabState) =>
  s.injuries.filter((i) => i.status === 'active')

export const resolvedInjuries = (s: RehabState) =>
  s.injuries
    .filter((i) => i.status === 'resolved')
    .sort((a, b) => (b.resolved ?? '').localeCompare(a.resolved ?? ''))
