// Weekly cardio-goal domain logic: the goal shape stored on profiles, its
// intensity buckets, and the rollup that compares a week of logged cardio
// entries against it. Pure — the query hook lives in features/exercise.
//
// One goal, two granularities: 'simple' splits the week into light (zones 1–2,
// moderate intensity) and heavy (zones 3–5, vigorous); 'zones' targets each of
// the 5 zones. Both read the same `exercise_entries` rows, so cardio logged in
// the diary and cardio logged from a programmed workout count identically.
import { HR_ZONE_BANDS } from './calc'
import type { CardioGoal, CardioGoalMode } from './database.types'
import { zoneColor } from '@/data/zones'

/** Zones 1–2 are moderate intensity, 3–5 vigorous (ACSM %HRmax bands). */
export const LIGHT_ZONES = [1, 2] as const
export const HEAVY_ZONES = [3, 4, 5] as const

/** Guideline window in MVPA minutes/week (WHO / US Physical Activity
 *  Guidelines): 150–300 moderate, with vigorous minutes worth double. */
export const MVPA_MIN = 150
export const MVPA_MAX = 300

/** Starting point for a new goal — 150 light + 45 heavy = 240 MVPA min. */
export const DEFAULT_CARDIO_GOAL: CardioGoal = {
  mode: 'simple',
  light: 150,
  heavy: 45,
  zones: [30, 90, 25, 15, 10],
}

/** Per-week minutes are clamped to a sane range; junk parses to 0. */
export function clampGoalMinutes(n: unknown): number {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.max(0, Math.min(1200, v)) : 0
}

/**
 * Normalize the stored jsonb into a full goal, tolerating partial/legacy saves.
 * When nothing is stored yet, `legacyTotal` (profiles.weekly_cardio_min_target,
 * the old single Progress target) seeds simple mode so the existing number
 * carries over untouched — it was a total, so it lands on light with heavy
 * untracked, keeping the same total-vs-target readout. Null = no goal set.
 */
export function resolveCardioGoal(
  raw: unknown,
  legacyTotal?: number | null,
): CardioGoal | null {
  if (raw && typeof raw === 'object') {
    const g = raw as Partial<CardioGoal>
    const zones = Array.isArray(g.zones) ? g.zones : []
    return {
      mode: g.mode === 'zones' ? 'zones' : 'simple',
      light: clampGoalMinutes(g.light),
      heavy: clampGoalMinutes(g.heavy),
      zones: HR_ZONE_BANDS.map((_, i) => clampGoalMinutes(zones[i])),
    }
  }
  if (legacyTotal != null && legacyTotal > 0)
    return { ...DEFAULT_CARDIO_GOAL, light: clampGoalMinutes(legacyTotal), heavy: 0 }
  return null
}

/** Total targeted minutes/week in whichever mode the goal is in. */
export const cardioGoalTotal = (g: CardioGoal): number =>
  g.mode === 'zones'
    ? g.zones.reduce((s, m) => s + m, 0)
    : g.light + g.heavy

/** MVPA minutes a goal is worth: moderate + 2 × vigorous. */
export const cardioGoalMvpa = (g: CardioGoal): number =>
  g.mode === 'zones'
    ? g.zones[0] + g.zones[1] + 2 * (g.zones[2] + g.zones[3] + g.zones[4])
    : g.light + 2 * g.heavy

/** Which intensity half a zone belongs to. Entries with no zone (manual or MET
 *  logging, no HR) count as light rather than vanishing from the goal. */
export const bucketForZone = (zone: number | null | undefined): 'light' | 'heavy' =>
  zone != null && zone >= 3 ? 'heavy' : 'light'

export type BucketKey = 'light' | 'heavy' | 'unzoned' | `z${number}`

export interface CardioBucket {
  key: BucketKey
  label: string
  /** Short descriptor under the label, e.g. "zones 1–2" or "aerobic base". */
  sublabel: string
  color: string
  done: number
  /** 0 = nothing targeted for this bucket (minutes still count in the total). */
  target: number
}

export interface CardioWeekSummary {
  mode: CardioGoalMode
  buckets: CardioBucket[]
  totalDone: number
  totalTarget: number
  /** Minutes logged with no zone — folded into light in simple mode, listed as
   *  its own row in zones mode (it can't be attributed to one zone). */
  unzoned: number
  /** Guideline currency: moderate minutes + 2 × vigorous minutes. */
  mvpaDone: number
  mvpaTarget: number
  /** Whole-percent progress toward the total target (0 when nothing targeted). */
  pct: number
  /** Entries that contributed time this week. */
  sessions: number
}

/** The fields the rollup reads off an exercise_entries row. */
export interface CardioWeekEntry {
  duration_min: number | null
  zone: number | null
}

const pct = (done: number, target: number): number =>
  target > 0 ? Math.max(0, Math.min(999, Math.round((done / target) * 100))) : 0

/**
 * Roll a week of cardio entries up against the goal. Entries without a duration
 * contribute nothing; zones outside 1–5 are treated as unzoned.
 */
export function summarizeCardioWeek(
  entries: CardioWeekEntry[],
  goal: CardioGoal,
): CardioWeekSummary {
  const perZone = HR_ZONE_BANDS.map(() => 0)
  let unzoned = 0
  let sessions = 0
  for (const e of entries) {
    const min = e.duration_min ?? 0
    if (!(min > 0)) continue
    sessions++
    const z = e.zone
    if (z != null && z >= 1 && z <= perZone.length) perZone[z - 1] += min
    else unzoned += min
  }
  const round = (n: number) => Math.round(n)
  const zoneMin = perZone.map(round)
  unzoned = round(unzoned)

  const lightLogged = zoneMin[0] + zoneMin[1] + unzoned
  const heavyLogged = zoneMin[2] + zoneMin[3] + zoneMin[4]

  const buckets: CardioBucket[] =
    goal.mode === 'zones'
      ? [
          ...HR_ZONE_BANDS.map((b, i) => ({
            key: `z${b.zone}` as BucketKey,
            label: `Zone ${b.zone}`,
            sublabel: b.name.toLowerCase(),
            color: zoneColor(b.zone),
            done: zoneMin[i],
            target: goal.zones[i],
          })),
          ...(unzoned > 0
            ? [
                {
                  key: 'unzoned' as BucketKey,
                  label: 'No zone',
                  sublabel: 'logged without a heart rate',
                  color: zoneColor(0),
                  done: unzoned,
                  target: 0,
                },
              ]
            : []),
        ]
      : [
          {
            key: 'light',
            label: 'Light',
            sublabel: 'zones 1–2',
            color: zoneColor(2),
            done: lightLogged,
            target: goal.light,
          },
          {
            key: 'heavy',
            label: 'Heavy',
            sublabel: 'zones 3–5',
            color: zoneColor(4),
            done: heavyLogged,
            target: goal.heavy,
          },
        ]

  const totalDone = buckets.reduce((s, b) => s + b.done, 0)
  const totalTarget = cardioGoalTotal(goal)
  return {
    mode: goal.mode,
    buckets,
    totalDone,
    totalTarget,
    unzoned,
    mvpaDone: lightLogged + 2 * heavyLogged,
    mvpaTarget: cardioGoalMvpa(goal),
    pct: pct(totalDone, totalTarget),
    sessions,
  }
}

/** One-line verdict on a goal's weekly MVPA load, for the goal editor. */
export function mvpaVerdict(mvpa: number): { text: string; ok: boolean } {
  if (mvpa === 0) return { text: 'No minutes targeted yet', ok: false }
  if (mvpa < MVPA_MIN)
    return {
      text: `${mvpa} MVPA min/wk — under the ${MVPA_MIN} minute guideline`,
      ok: false,
    }
  if (mvpa > MVPA_MAX)
    return { text: `${mvpa} MVPA min/wk — above ${MVPA_MAX}, ambitious`, ok: true }
  return {
    text: `${mvpa} MVPA min/wk — meets the ${MVPA_MIN}–${MVPA_MAX} guideline`,
    ok: true,
  }
}
