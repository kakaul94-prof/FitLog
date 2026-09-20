// Week/Month in review: period math + goal scoring. Pure — the rows are fetched
// in features/report/useReport.ts and scored here so the rules are unit-tested.
// Every goal scored already exists elsewhere in the app (calorie goal, macro
// targets, cardio goal, step goal, muscle set targets, mobility minutes); this
// file only rolls them up over a period.
import { addDaysISO } from './date'
import { weekStartISO } from './cardio'

export type ReportKind = 'week' | 'month'

export interface ReportPeriod {
  kind: ReportKind
  /** First day, inclusive. Weeks run Monday–Sunday, like the weekly cardio goal. */
  start: string
  /** Last day, inclusive. */
  end: string
}

function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${iso.slice(0, 8)}${String(last).padStart(2, '0')}`
}

export function periodContaining(kind: ReportKind, iso: string): ReportPeriod {
  if (kind === 'week') {
    const start = weekStartISO(iso)
    return { kind, start, end: addDaysISO(start, 6) }
  }
  return { kind, start: `${iso.slice(0, 8)}01`, end: lastDayOfMonth(iso) }
}

/** The most recent period that has fully ended — what the report opens on. A
 *  period in progress scores most weekly goals as misses, which says nothing. */
export const lastCompletedPeriod = (kind: ReportKind, today: string): ReportPeriod =>
  periodContaining(kind, addDaysISO(periodContaining(kind, today).start, -1))

export const shiftPeriod = (p: ReportPeriod, dir: -1 | 1): ReportPeriod =>
  periodContaining(p.kind, dir < 0 ? addDaysISO(p.start, -1) : addDaysISO(p.end, 1))

export const isCurrentPeriod = (p: ReportPeriod, today: string): boolean =>
  p.start <= today && today <= p.end

/** Last day the report counts: the period's end, or today while it's in progress. */
export const coveredEnd = (p: ReportPeriod, today: string): string =>
  p.end < today ? p.end : today

/** Forward stops at the period in progress — nothing to score past today. */
export const canGoForward = (p: ReportPeriod, today: string): boolean => p.end < today

/** "Sep 7 – 13", "Aug 31 – Sep 6", or "September 2026". */
export function periodLabel(p: ReportPeriod): string {
  const s = new Date(p.start + 'T00:00:00')
  if (p.kind === 'month')
    return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const e = new Date(p.end + 'T00:00:00')
  const sm = s.toLocaleDateString(undefined, { month: 'short' })
  const em = e.toLocaleDateString(undefined, { month: 'short' })
  return sm === em
    ? `${sm} ${s.getDate()} – ${e.getDate()}`
    : `${sm} ${s.getDate()} – ${em} ${e.getDate()}`
}

export interface ReportBucket {
  start: string
  end: string
  label: string
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Detail columns under a goal bar: a week shows its 7 days; a month shows its
 *  Monday-weeks clipped to the month, so one layout serves both. */
export function periodBuckets(p: ReportPeriod): ReportBucket[] {
  if (p.kind === 'week')
    return DAY_LETTERS.map((label, i) => {
      const d = addDaysISO(p.start, i)
      return { start: d, end: d, label }
    })
  const out: ReportBucket[] = []
  for (let s = p.start; s <= p.end; ) {
    const weekEnd = addDaysISO(weekStartISO(s), 6)
    const e = weekEnd < p.end ? weekEnd : p.end
    out.push({ start: s, end: e, label: `${Number(s.slice(8))}–${Number(e.slice(8))}` })
    s = addDaysISO(e, 1)
  }
  return out
}

// ---------- scoring ----------

export type GoalStatus = 'hit' | 'close' | 'miss'

/** Floor goals (protein, steps, minutes): at least this share of target is a hit… */
export const HIT_AT = 0.95
/** …and at least this share is close. Below it is a miss. */
export const CLOSE_AT = 0.8
/** Calories are two-sided: within ±10% of the goal is a hit. */
export const CALORIE_BAND = 0.1
/** Under the band is only "close" (off plan, not overeating) until it's this far under. */
export const CALORIE_UNDER_MISS = 0.75
/** Under this share of covered days logged, the averages are flagged as rough. */
export const MIN_LOGGED_SHARE = 0.7
/** Weight trend within this many lb/wk of the goal rate counts as on pace. */
export const PACE_TOLERANCE = 0.25

export function scoreFloor(done: number, target: number): GoalStatus {
  if (target <= 0) return 'hit'
  const r = done / target
  return r >= HIT_AT ? 'hit' : r >= CLOSE_AT ? 'close' : 'miss'
}

export function scoreBand(value: number, goal: number): GoalStatus {
  if (goal <= 0) return 'hit'
  const r = value / goal
  if (r > 1 + CALORIE_BAND) return 'miss'
  if (r >= 1 - CALORIE_BAND) return 'hit'
  return r >= CALORIE_UNDER_MISS ? 'close' : 'miss'
}

export const onPace = (trendLbPerWeek: number, goalRateLbPerWeek: number): boolean =>
  Math.abs(trendLbPerWeek - goalRateLbPerWeek) <= PACE_TOLERANCE

// ---------- report ----------

export interface ReportDay {
  date: string
  /** At least one food entry that day. */
  logged: boolean
  kcal: number
  protein: number
  /** Cardio calories — calories are scored net of these, like the diary. */
  burned: number
  /** The calorie goal in effect that day (goal history), null when unset. */
  calorieGoal: number | null
  proteinTarget: number | null
  cardioMin: number
  workouts: number
  mobilitySec: number
  /** Health Connect steps; null when there's no reading. */
  steps: number | null
}

export interface MuscleTarget {
  label: string
  /** Fractional sets over the covered days (primary 1.0, secondary 0.5). */
  sets: number
  weeklyGoal: number
}

export interface ReportInput {
  period: ReportPeriod
  today: string
  /** One row per date from period.start through coveredEnd, in order. */
  days: ReportDay[]
  cardioWeeklyMin: number | null
  stepGoal: number | null
  mobilityWeeklySec: number
  /** Tracked muscle regions only (weekly set goal > 0). */
  muscles: MuscleTarget[]
}

export type GoalKey = 'calories' | 'protein' | 'strength' | 'cardio' | 'steps' | 'mobility'
export type CellTone = GoalStatus | 'done' | 'none'

export interface ReportCell {
  label: string
  value: string
  tone: CellTone
}

export interface ReportGoal {
  key: GoalKey
  label: string
  value: string
  /** Rendered after the value, e.g. "/ 170 g". */
  target: string
  /** The gap in words ("42 g short"); empty when there's nothing to say. */
  note: string
  status: GoalStatus
  /** done ÷ target — positions the bar fill against the goal line. */
  ratio: number
  /** Two-sided goal: the bar shades the in-range band around the line. */
  band: boolean
  cells: ReportCell[]
  summary: string
}

export interface ReportResult {
  /** Misses first, then close, then hits. */
  goals: ReportGoal[]
  met: number
  missed: string[]
  loggedDays: number
  coveredDays: number
  lowCoverage: boolean
}

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0)
const avg = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0)
const fmt = (n: number): string => Math.round(n).toLocaleString()
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function fmtSteps(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = Math.round(n / 100) / 10
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`
}

type CellScore = (days: ReportDay[]) => { value: string; tone: CellTone } | null

/** Score each bucket's covered days; null from `score` = no data ("—"). Days
 *  after `end` haven't happened yet and stay blank. */
function cellsFor(
  input: ReportInput,
  buckets: ReportBucket[],
  score: CellScore,
): ReportCell[] {
  const end = coveredEnd(input.period, input.today)
  return buckets.map((b): ReportCell => {
    if (b.start > end) return { label: b.label, value: '', tone: 'none' }
    const ds = input.days.filter((d) => d.date >= b.start && d.date <= b.end)
    return { label: b.label, ...(score(ds) ?? NO_DATA) }
  })
}

const NO_DATA = { value: '—', tone: 'none' } as const

type GoalBuilder = (input: ReportInput, buckets: ReportBucket[]) => ReportGoal | null

const net = (d: ReportDay): number => d.kcal - d.burned
const hasCalorieGoal = (d: ReportDay): boolean =>
  d.logged && d.calorieGoal != null && d.calorieGoal > 0

const calories: GoalBuilder = (input, buckets) => {
  const scored = input.days.filter(hasCalorieGoal)
  if (!scored.length) return null
  const value = avg(scored.map(net))
  const goal = avg(scored.map((d) => d.calorieGoal as number))
  const status = scoreBand(value, goal)
  const diff = value - goal
  const inRange = scored.filter((d) => scoreBand(net(d), d.calorieGoal as number) === 'hit').length
  const over = scored.filter(
    (d) => net(d) > (d.calorieGoal as number) * (1 + CALORIE_BAND),
  ).length
  return {
    key: 'calories',
    label: 'Calories',
    value: fmt(value),
    target: `/ ${fmt(goal)}`,
    note: status === 'hit' ? 'in range' : diff > 0 ? `${fmt(diff)} over` : `${fmt(-diff)} under`,
    status,
    ratio: value / goal,
    band: true,
    cells: cellsFor(input, buckets, (ds) => {
      const s = ds.filter(hasCalorieGoal)
      if (!s.length) return null
      const v = avg(s.map(net))
      return { value: fmt(v), tone: scoreBand(v, avg(s.map((d) => d.calorieGoal as number))) }
    }),
    summary: `Net of exercise · in range on ${inRange} of ${plural(scored.length, 'logged day')}${
      over ? ` · over on ${over}` : ''
    }`,
  }
}

const protein: GoalBuilder = (input, buckets) => {
  const has = (d: ReportDay) => d.logged && d.proteinTarget != null && d.proteinTarget > 0
  const scored = input.days.filter(has)
  if (!scored.length) return null
  const value = avg(scored.map((d) => d.protein))
  const target = avg(scored.map((d) => d.proteinTarget as number))
  const status = scoreFloor(value, target)
  const hitDays = scored.filter(
    (d) => scoreFloor(d.protein, d.proteinTarget as number) === 'hit',
  ).length
  return {
    key: 'protein',
    label: 'Protein',
    value: fmt(value),
    target: `/ ${fmt(target)} g`,
    note: status === 'hit' ? '' : `${fmt(target - value)} g short`,
    status,
    ratio: value / target,
    band: false,
    cells: cellsFor(input, buckets, (ds) => {
      const s = ds.filter(has)
      if (!s.length) return null
      const v = avg(s.map((d) => d.protein))
      return { value: fmt(v), tone: scoreFloor(v, avg(s.map((d) => d.proteinTarget as number))) }
    }),
    summary: `Daily average · hit on ${hitDays} of ${plural(scored.length, 'logged day')}`,
  }
}

const strength: GoalBuilder = (input, buckets) => {
  if (!input.muscles.length) return null
  // Weekly set targets scale to the days covered (a month, or a week so far).
  const scale = input.days.length / 7
  const rows = input.muscles.map((m) => ({ ...m, ratio: m.sets / (m.weeklyGoal * scale) }))
  const onTarget = rows.filter((r) => r.ratio >= 1).length
  const low = rows.filter((r) => r.ratio < 1).sort((a, b) => a.ratio - b.ratio)
  const status = scoreFloor(onTarget, rows.length)
  const lowNames = low.slice(0, 3).map((r) => r.label.toLowerCase())
  const workouts = sum(input.days.map((d) => d.workouts))
  const weekly = input.period.kind === 'week'
  return {
    key: 'strength',
    label: 'Strength',
    value: String(onTarget),
    target: `/ ${rows.length} muscles`,
    note: !low.length ? '' : low.length <= 2 ? `${lowNames.join(', ')} low` : `${low.length} muscles low`,
    status,
    ratio: onTarget / rows.length,
    band: false,
    cells: cellsFor(input, buckets, (ds) => {
      const n = sum(ds.map((d) => d.workouts))
      return { value: weekly ? '' : n ? String(n) : '', tone: n ? 'done' : 'none' }
    }),
    summary: `${plural(workouts, 'workout')} · ${
      low.length
        ? `under set target: ${lowNames.join(', ')}${low.length > 3 ? ` +${low.length - 3} more` : ''}`
        : 'every tracked muscle on target'
    }`,
  }
}

const cardio: GoalBuilder = (input, buckets) => {
  const weekly = input.cardioWeeklyMin
  if (!weekly || weekly <= 0) return null
  const done = sum(input.days.map((d) => d.cardioMin))
  const target = (weekly * input.days.length) / 7
  const status = scoreFloor(done, target)
  const activeDays = input.days.filter((d) => d.cardioMin > 0).length
  const perDay = input.period.kind === 'week'
  return {
    key: 'cardio',
    label: 'Cardio',
    value: fmt(done),
    target: `/ ${fmt(target)} min`,
    note: status === 'hit' ? '' : `${fmt(target - done)} min short`,
    status,
    ratio: done / target,
    band: false,
    cells: cellsFor(input, buckets, (ds) => {
      const m = sum(ds.map((d) => d.cardioMin))
      if (perDay) return m > 0 ? { value: `${fmt(m)}m`, tone: 'done' } : { value: '', tone: 'none' }
      return { value: `${fmt(m)}m`, tone: scoreFloor(m, (weekly * ds.length) / 7) }
    }),
    summary: `Cardio on ${plural(activeDays, 'day')} · ${fmt(done)} of ${fmt(target)} min`,
  }
}

const steps: GoalBuilder = (input, buckets) => {
  const goal = input.stepGoal
  if (!goal || goal <= 0) return null
  const read = input.days.filter((d) => d.steps != null)
  if (!read.length) return null
  const value = avg(read.map((d) => d.steps as number))
  const status = scoreFloor(value, goal)
  const hitDays = read.filter((d) => scoreFloor(d.steps as number, goal) === 'hit').length
  return {
    key: 'steps',
    label: 'Steps',
    value: fmtSteps(value),
    target: `/ ${fmtSteps(goal)}`,
    note: status === 'hit' ? '' : `${fmtSteps(goal - value)} short`,
    status,
    ratio: value / goal,
    band: false,
    cells: cellsFor(input, buckets, (ds) => {
      const s = ds.filter((d) => d.steps != null)
      if (!s.length) return null
      const v = avg(s.map((d) => d.steps as number))
      return { value: fmtSteps(v), tone: scoreFloor(v, goal) }
    }),
    summary: `Daily average · hit on ${hitDays} of ${plural(read.length, 'day')}`,
  }
}

const mobility: GoalBuilder = (input, buckets) => {
  const weekly = input.mobilityWeeklySec
  if (weekly <= 0) return null
  const done = sum(input.days.map((d) => d.mobilitySec))
  const target = (weekly * input.days.length) / 7
  const status = scoreFloor(done, target)
  const perDay = input.period.kind === 'week'
  const min = (sec: number) => fmt(sec / 60)
  return {
    key: 'mobility',
    label: 'Mobility',
    value: min(done),
    target: `/ ${min(target)} min`,
    note: status === 'hit' ? '' : `${min(target - done)} min short`,
    status,
    ratio: done / target,
    band: false,
    cells: cellsFor(input, buckets, (ds) => {
      const s = sum(ds.map((d) => d.mobilitySec))
      if (perDay) return s > 0 ? { value: `${min(s)}m`, tone: 'done' } : { value: '', tone: 'none' }
      return { value: `${min(s)}m`, tone: scoreFloor(s, (weekly * ds.length) / 7) }
    }),
    summary: `${min(done)} of ${min(target)} min`,
  }
}

const BUILDERS: GoalBuilder[] = [calories, protein, strength, cardio, steps, mobility]
const STATUS_ORDER: Record<GoalStatus, number> = { miss: 0, close: 1, hit: 2 }

export function buildReport(input: ReportInput): ReportResult {
  const buckets = periodBuckets(input.period)
  const goals = BUILDERS.map((b) => b(input, buckets)).filter(
    (g): g is ReportGoal => g != null,
  )
  // Stable sort: misses surface first, builder order breaks ties.
  goals.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  const loggedDays = input.days.filter((d) => d.logged).length
  const coveredDays = input.days.length
  return {
    goals,
    met: goals.filter((g) => g.status === 'hit').length,
    missed: goals.filter((g) => g.status === 'miss').map((g) => g.label),
    loggedDays,
    coveredDays,
    lowCoverage: coveredDays > 0 && loggedDays / coveredDays < MIN_LOGGED_SHARE,
  }
}
