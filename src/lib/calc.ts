import type {
  ActivityLevel,
  GoalHistoryEntry,
  MacroTargets,
  Profile,
  Sex,
} from './database.types'
import { daysBetweenISO } from './date'

// ---------- unit conversions ----------
export const LB_PER_KG = 2.2046226218
export const lbToKg = (lb: number) => lb / LB_PER_KG
export const kgToLb = (kg: number) => kg * LB_PER_KG
export const cmToInches = (cm: number) => cm / 2.54

// Round to the nearest half-gram (0.5) — used for macro displays.
export const roundHalf = (n: number) => Math.round(n * 2) / 2
export const inchesToCm = (inches: number) => inches * 2.54

export function cmToFtIn(cm: number): { ft: number; inch: number } {
  const totalIn = Math.round(cmToInches(cm))
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}
export const ftInToCm = (ft: number, inch: number) => inchesToCm(ft * 12 + inch)

// ---------- age ----------
export function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

// ---------- heart-rate training zones ----------
// Max HR via Tanaka (2001): 208 − 0.7·age — more accurate than 220−age, age-only.
export function hrMax(age: number): number {
  return Math.round(208 - 0.7 * age)
}

export interface HrZoneBand {
  zone: number
  name: string
  /** Fraction-of-max-HR bounds: [pctLo, pctHi). */
  pctLo: number
  pctHi: number
}

/** The 5 classic %HRmax training zones (low → high intensity). */
export const HR_ZONE_BANDS: HrZoneBand[] = [
  { zone: 1, name: 'Recovery', pctLo: 0.5, pctHi: 0.6 },
  { zone: 2, name: 'Aerobic base', pctLo: 0.6, pctHi: 0.7 },
  { zone: 3, name: 'Tempo', pctLo: 0.7, pctHi: 0.8 },
  { zone: 4, name: 'Threshold', pctLo: 0.8, pctHi: 0.9 },
  { zone: 5, name: 'VO₂ max', pctLo: 0.9, pctHi: 1.0 },
]

export interface HrZone extends HrZoneBand {
  loBpm: number
  hiBpm: number
}

/** A usable resting HR for Karvonen (positive and below max), else null. */
function usableRest(maxHr: number, restingHr?: number | null): number | null {
  return restingHr != null && restingHr > 0 && restingHr < maxHr ? restingHr : null
}

/** The bpm at an intensity fraction — Karvonen (heart-rate reserve) when a valid
 * resting HR is supplied, else plain %HRmax. */
function bpmAt(pct: number, maxHr: number, restingHr?: number | null): number {
  const rest = usableRest(maxHr, restingHr)
  return Math.round(rest != null ? rest + pct * (maxHr - rest) : maxHr * pct)
}

/**
 * The 5 zone bands as bpm ranges. With a valid resting HR the bounds use
 * heart-rate reserve (Karvonen); otherwise plain %HRmax.
 */
export function hrZones(maxHr: number, restingHr?: number | null): HrZone[] {
  return HR_ZONE_BANDS.map((b) => ({
    ...b,
    loBpm: bpmAt(b.pctLo, maxHr, restingHr),
    hiBpm: bpmAt(b.pctHi, maxHr, restingHr),
  }))
}

/**
 * Zone (1–5) for an average HR; null below Zone 1 (<50% intensity). Uses the
 * Karvonen reserve when a valid resting HR is supplied, else %HRmax.
 */
export function zoneForHr(
  hr: number,
  maxHr: number,
  restingHr?: number | null,
): number | null {
  if (!hr || hr <= 0) return null
  const rest = usableRest(maxHr, restingHr)
  const pct = rest != null ? (hr - rest) / (maxHr - rest) : hr / maxHr
  if (pct < 0.5) return null
  if (pct < 0.6) return 1
  if (pct < 0.7) return 2
  if (pct < 0.8) return 3
  if (pct < 0.9) return 4
  return 5
}

/** A profile's effective max HR: their set value, else the age estimate, else null. */
export function resolveMaxHr(profile: Profile | null | undefined): number | null {
  if (profile?.max_hr != null) return profile.max_hr
  const age = ageFromBirthDate(profile?.birth_date ?? null)
  return age != null ? hrMax(age) : null
}

/** A profile's zone bpm ranges (Karvonen when resting HR is set), or null when
 * there's no max HR to work from. */
export function resolveHrZones(
  profile: Profile | null | undefined,
): HrZone[] | null {
  const max = resolveMaxHr(profile)
  return max != null ? hrZones(max, profile?.resting_hr ?? null) : null
}

/** Zone (1–5) for an avg HR under a profile's settings; null when unavailable. */
export function resolveZoneForHr(
  hr: number,
  profile: Profile | null | undefined,
): number | null {
  const max = resolveMaxHr(profile)
  return max != null ? zoneForHr(hr, max, profile?.resting_hr ?? null) : null
}

// ---------- energy expenditure ----------
const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (little/no exercise)',
  light: 'Light (1–3 days/week)',
  moderate: 'Moderate (3–5 days/week)',
  active: 'Active (6–7 days/week)',
  very_active: 'Very active (hard daily / physical job)',
}

/** Mifflin–St Jeor basal metabolic rate (kcal/day). */
export function bmrMifflin(
  weightLb: number,
  heightCm: number,
  age: number,
  sex: Sex,
): number {
  const kg = lbToKg(weightLb)
  const base = 10 * kg + 6.25 * heightCm - 5 * age
  return base + (sex === 'male' ? 5 : -161)
}

export function tdee(bmr: number, activity: ActivityLevel): number {
  return bmr * ACTIVITY_FACTORS[activity]
}

/** ~3500 kcal per lb → per-day kcal change for a given weekly rate. */
export const KCAL_PER_LB = 3500
export function caloriesForRate(lbPerWeek: number): number {
  return (lbPerWeek * KCAL_PER_LB) / 7
}

export interface CalorieGoalResult {
  bmr: number | null
  tdee: number | null
  calculated: number | null // suggested from profile
  goal: number | null // what to actually use (respects manual override)
  mode: 'calculated' | 'manual'
  missing: string[] // profile fields needed for a calculated goal
}

/** Resolve the daily calorie goal from profile + latest weight (hybrid). */
export function resolveCalorieGoal(
  profile: Pick<
    Profile,
    | 'sex'
    | 'birth_date'
    | 'height_cm'
    | 'activity_level'
    | 'goal_rate_lb_per_week'
    | 'calorie_goal_mode'
    | 'manual_calorie_goal'
  >,
  latestWeightLb: number | null,
): CalorieGoalResult {
  const age = ageFromBirthDate(profile.birth_date)
  const missing: string[] = []
  if (!profile.sex) missing.push('sex')
  if (age == null) missing.push('birth date')
  if (!profile.height_cm) missing.push('height')
  if (latestWeightLb == null) missing.push('current weight')

  let bmr: number | null = null
  let total: number | null = null
  let calculated: number | null = null
  if (
    profile.sex &&
    age != null &&
    profile.height_cm &&
    latestWeightLb != null
  ) {
    bmr = bmrMifflin(latestWeightLb, profile.height_cm, age, profile.sex)
    total = tdee(bmr, profile.activity_level)
    calculated = Math.round(
      total + caloriesForRate(profile.goal_rate_lb_per_week),
    )
  }

  const goal =
    profile.calorie_goal_mode === 'manual'
      ? (profile.manual_calorie_goal ?? calculated)
      : calculated
  return {
    bmr: bmr != null ? Math.round(bmr) : null,
    tdee: total != null ? Math.round(total) : null,
    calculated,
    goal,
    mode: profile.calorie_goal_mode,
    missing,
  }
}

// ---------- dated calorie-goal history ----------
// Changing your goal shouldn't rewrite past days. We keep a dated log of goal
// values (GoalHistoryEntry); a past day shows the value in effect then, while
// today/future always use the live goal (so current settings/weight still show
// through). The first change seeds a baseline so pre-history days stay put.

// Baseline entries use this sentinel start so they precede any real diary day.
export const GOAL_HISTORY_BASELINE_DATE = '2000-01-01'

/** The recorded goal in effect on `dateISO` (latest entry with `from` ≤ date),
 * or null when history has no entry that early. */
function recordedGoalOnOrBefore(
  history: GoalHistoryEntry[],
  dateISO: string,
): number | null {
  let best: GoalHistoryEntry | null = null
  for (const e of history) {
    if (e.from <= dateISO && (best == null || e.from > best.from)) best = e
  }
  return best ? best.goal : null
}

/**
 * The calorie goal to display for a given day. Today/future use `liveGoal`
 * (current profile + weight); a past day uses the value that was in effect then,
 * falling back to `liveGoal` when nothing was recorded that early (e.g. before
 * any goal change).
 */
export function goalForDate(
  history: GoalHistoryEntry[] | null | undefined,
  dateISO: string,
  liveGoal: number | null,
  todayISO: string,
): number | null {
  if (dateISO >= todayISO) return liveGoal
  const recorded = recordedGoalOnOrBefore(history ?? [], dateISO)
  return recorded != null ? recorded : liveGoal
}

/**
 * Fold a goal change into the dated history (one entry per day). No-op when the
 * goal in effect today isn't actually changing. The first-ever change seeds a
 * baseline holding the OLD goal so every prior day stays frozen at it; then
 * today's entry holds the new goal. Returns the next history array.
 */
export function recordGoalChange(
  history: GoalHistoryEntry[] | null | undefined,
  opts: { today: string; oldGoal: number | null; newGoal: number | null },
): GoalHistoryEntry[] {
  const { today, oldGoal, newGoal } = opts
  const hist = [...(history ?? [])]
  if (newGoal == null) return hist
  // What the day currently resolves to: a recorded entry if one exists, else the
  // live/old goal that's been showing via fallback.
  const recordedToday = recordedGoalOnOrBefore(hist, today)
  const effectiveBefore = recordedToday != null ? recordedToday : oldGoal
  if (effectiveBefore === newGoal) return hist // nothing actually changed
  // First recorded change: freeze all prior days at the old value.
  if (hist.length === 0 && oldGoal != null) {
    hist.push({ from: GOAL_HISTORY_BASELINE_DATE, goal: oldGoal })
  }
  const next = hist.filter((e) => e.from !== today)
  next.push({ from: today, goal: newGoal })
  next.sort((a, b) => a.from.localeCompare(b.from))
  return next
}

// ---------- adaptive TDEE (data-driven maintenance) ----------
// Pure energy balance: if you average `intake` kcal/day and your weight trends
// by `s` lb/day, then maintenance = intake - s*3500. The slope comes from a
// least-squares fit over your weigh-ins (robust to day-to-day water noise), and
// intake is averaged over *logged* days only, within the weigh-in span.

export interface AdaptiveWeight {
  date: string
  value: number
}
export interface AdaptiveIntakeDay {
  date: string
  kcal: number
}

export interface AdaptiveTDEEResult {
  enough: boolean
  tdee: number | null // measured maintenance kcal/day
  avgIntake: number | null
  loggedDays: number
  spanDays: number // days between first & last weigh-in
  trendLbPerWeek: number | null // negative = losing
  reason: string | null // why there isn't enough data yet
}

export const ADAPTIVE_MIN_SPAN_DAYS = 14
export const ADAPTIVE_MIN_LOGGED_DAYS = 10
// Days below this kcal are treated as incomplete logging and ignored.
const ADAPTIVE_MIN_DAY_KCAL = 500

/** Least-squares slope of y over x; null if x has no spread. */
function regressionSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((s, x) => s + x, 0) / n
  const my = ys.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? null : num / den
}

/** Estimate maintenance kcal from logged intake + measured weight trend. */
export function estimateAdaptiveTDEE(
  intakeDays: AdaptiveIntakeDay[],
  weights: AdaptiveWeight[],
): AdaptiveTDEEResult {
  const base: AdaptiveTDEEResult = {
    enough: false,
    tdee: null,
    avgIntake: null,
    loggedDays: 0,
    spanDays: 0,
    trendLbPerWeek: null,
    reason: null,
  }
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  if (w.length < 2)
    return { ...base, reason: 'Log at least two weigh-ins a couple weeks apart.' }

  const first = w[0]
  const last = w[w.length - 1]
  const spanDays = daysBetweenISO(first.date, last.date)
  if (spanDays < ADAPTIVE_MIN_SPAN_DAYS)
    return {
      ...base,
      spanDays,
      reason: `Need ~2 weeks between weigh-ins (have ${spanDays}).`,
    }

  const inSpan = intakeDays.filter(
    (d) =>
      d.date >= first.date &&
      d.date <= last.date &&
      d.kcal >= ADAPTIVE_MIN_DAY_KCAL,
  )
  const loggedDays = inSpan.length
  if (loggedDays < ADAPTIVE_MIN_LOGGED_DAYS)
    return {
      ...base,
      spanDays,
      loggedDays,
      reason: `Keep logging — ${loggedDays} of ~${ADAPTIVE_MIN_LOGGED_DAYS} days needed.`,
    }

  const slope = regressionSlope(
    w.map((p) => daysBetweenISO(first.date, p.date)),
    w.map((p) => p.value),
  )
  if (slope == null)
    return {
      ...base,
      spanDays,
      loggedDays,
      reason: 'Not enough weight change to calibrate yet.',
    }

  const avgIntake = inSpan.reduce((s, d) => s + d.kcal, 0) / loggedDays
  const tdee = Math.round(avgIntake - slope * KCAL_PER_LB)
  return {
    enough: true,
    tdee,
    avgIntake: Math.round(avgIntake),
    loggedDays,
    spanDays,
    trendLbPerWeek: slope * 7,
    reason: null,
  }
}

// ---------- macro targets ----------
const KCAL_PER_G = { protein: 4, carb: 4, fat: 9 } as const
type MacroName = keyof typeof KCAL_PER_G

export interface ResolvedMacro {
  grams: number
  kcal: number
  pct: number
}
export type ResolvedMacros = Record<MacroName, ResolvedMacro>

/**
 * Turn the user's macro target settings into concrete grams/kcal/%.
 * Each macro is set by grams, g-per-lb, % of calories, or "remainder".
 */
export function resolveMacroTargets(
  calories: number,
  weightLb: number | null,
  targets: MacroTargets,
): ResolvedMacros {
  const order: MacroName[] = ['protein', 'fat', 'carb']
  const grams: Record<MacroName, number> = { protein: 0, carb: 0, fat: 0 }
  const remainders: MacroName[] = []

  for (const name of order) {
    const t = targets[name]
    if (t.mode === 'remainder') {
      remainders.push(name)
      continue
    }
    if (t.mode === 'g') grams[name] = t.value ?? 0
    else if (t.mode === 'g_per_lb') grams[name] = (t.value ?? 0) * (weightLb ?? 0)
    else if (t.mode === 'pct')
      grams[name] = ((t.value ?? 0) / 100) * calories / KCAL_PER_G[name]
  }

  const usedKcal = order
    .filter((n) => !remainders.includes(n))
    .reduce((sum, n) => sum + grams[n] * KCAL_PER_G[n], 0)

  if (remainders.length > 0) {
    const leftover = Math.max(0, calories - usedKcal)
    const each = leftover / remainders.length
    for (const name of remainders) grams[name] = each / KCAL_PER_G[name]
  }

  const out = {} as ResolvedMacros
  for (const name of order) {
    const kcal = grams[name] * KCAL_PER_G[name]
    out[name] = {
      grams: Math.round(grams[name]),
      kcal: Math.round(kcal),
      pct: calories > 0 ? Math.round((kcal / calories) * 100) : 0,
    }
  }
  return out
}

// ---------- strength ----------
/** Estimated one-rep max (Epley). Most accurate under ~10 reps. */
export function estimated1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

export const BAR_LB = 45

export interface WarmupStep {
  weightLb: number
  reps: number
  isBar?: boolean
}

/**
 * Warm-up ramp to a working weight: 50%×5, 70%×3, 90%×1, rounded to the
 * nearest 5 lb; barbell lifts start with the empty bar ×10. Steps at or above
 * the working weight, at or below the bar (barbell), or that round into the
 * previous step are dropped — a light working weight can yield [] (no ramp).
 */
export function warmupRamp(workingLb: number, barbell: boolean): WarmupStep[] {
  if (!Number.isFinite(workingLb) || workingLb <= 0) return []
  const steps: WarmupStep[] = []
  if (barbell && BAR_LB < workingLb) steps.push({ weightLb: BAR_LB, reps: 10, isBar: true })
  for (const [pct, reps] of [
    [0.5, 5],
    [0.7, 3],
    [0.9, 1],
  ] as const) {
    const w = Math.round((workingLb * pct) / 5) * 5
    if (w <= 0 || w >= workingLb) continue
    if (barbell && w <= BAR_LB) continue
    if (steps.some((s) => s.weightLb === w)) continue
    steps.push({ weightLb: w, reps })
  }
  return steps
}

// ---------- exercise calories ----------
/**
 * Body weight plus anything you carried (ruck plate, vest, pack), in lb — the
 * mass the estimate should actually move. Both burn formulas below scale
 * linearly with mass, which is the accepted approximation for backpack-style
 * loads on level ground: Pandolf's non-linear load term contributes only a few
 * percent until you add grade or rough terrain.
 */
export function effectiveWeightLb(
  bodyLb: number | null | undefined,
  loadLb: number | null | undefined,
): number {
  if (!bodyLb) return 0
  return bodyLb + Math.max(0, loadLb ?? 0)
}

/** MET at the bottom (level 1) and top of a machine's resistance scale. */
export const LEVEL_MET_MIN = 3.5
export const LEVEL_MET_MAX = 8.9

/**
 * MET for a machine resistance level, normalised to the FRACTION of that
 * machine's max — "level 5" means different work on a 10-level console than on
 * an 18-level one, so the raw number can't drive the estimate. Level 1 is the
 * floor of the scale (not zero resistance), hence level−1 over max−1.
 *
 * This fixes the scale mismatch between machines, not the calibration one: one
 * vendor's top level really is heavier than another's, and only watts would
 * catch that. Assumes cadence stays roughly constant across levels.
 */
export function levelMet(
  level: number | null | undefined,
  levelMax: number | null | undefined,
): number | null {
  if (!level || !levelMax || levelMax <= 1) return null
  const f = Math.min(1, Math.max(0, (level - 1) / (levelMax - 1)))
  return LEVEL_MET_MIN + (LEVEL_MET_MAX - LEVEL_MET_MIN) * f
}

/** Neutral machine cadence in console-mph — the pace at which the level MET
 *  applies unscaled. Console "miles" aren't standardized across vendors, so
 *  retune this if estimates drift from a machine's reality. */
export const MACHINE_REF_MPH = 6

/**
 * Cadence-adjusted MET for machine cardio (elliptical). levelMet assumes a
 * constant cadence; when the console reports a distance, the measured pace
 * scales the WORK portion of the MET — at a fixed resistance, work is
 * force × strides, so kcal track distance — while the 1-MET resting floor
 * stays fixed. The factor is clamped because vendor "miles" vary wildly;
 * without distance or duration this is a no-op, preserving the plain
 * level/MET estimate.
 */
export function cadenceAdjustedMet(
  met: number,
  distanceMi: number,
  durationMin: number,
): number {
  if (!met || !distanceMi || !durationMin) return met
  const mph = distanceMi / (durationMin / 60)
  const factor = Math.min(1.4, Math.max(0.7, mph / MACHINE_REF_MPH))
  return 1 + (met - 1) * factor
}

/** MET estimate: kcal = MET * 3.5 * kg / 200 * minutes. */
export function metCalories(
  met: number,
  durationMin: number,
  weightLb: number,
): number {
  if (!met || !durationMin || !weightLb) return 0
  return Math.round(((met * 3.5 * lbToKg(weightLb)) / 200) * durationMin)
}

/** Distance-based burn (walk/run/hike): ~1 kcal/kg/km running, ~0.5 walking. */
export function distanceCalories(
  distanceMi: number,
  weightLb: number,
  met: number,
): number {
  if (!distanceMi || !weightLb) return 0
  const km = distanceMi * 1.60934
  const coef = met >= 7 ? 1.0 : 0.6
  return Math.round(coef * lbToKg(weightLb) * km)
}

/** Distance burn coefficient (kcal per kg per km) from measured speed (mph). */
export function distanceCoef(speedMph: number): number {
  return speedMph >= 5 ? 1.0 : 0.6 // ~5 mph is the walk→run transition
}

/**
 * Pace-aware distance burn — like distanceCalories, but the walk/run
 * coefficient comes from the MEASURED speed rather than the activity label.
 * Used by the GPS recorder, which knows your actual pace, so a fast 2-mile
 * effort isn't under-counted the way a label-based "Walking" entry would be.
 * `movingMin` is minutes actually moving (excludes stops), so a long pause
 * doesn't drag the pace down into the walking bracket.
 */
export function paceAwareCalories(
  distanceMi: number,
  movingMin: number,
  weightLb: number,
): number {
  if (!distanceMi || !weightLb) return 0
  const km = distanceMi * 1.60934
  const speedMph = movingMin > 0 ? distanceMi / (movingMin / 60) : 0
  return Math.round(distanceCoef(speedMph) * lbToKg(weightLb) * km)
}

// ---------- body ----------
/** Body Mass Index from weight (lb) and height (cm). */
export function bmi(weightLb: number, heightCm: number): number {
  const kg = lbToKg(weightLb)
  const m = heightCm / 100
  return kg / (m * m)
}

// ---------- trend smoothing ----------
export interface TrendPoint {
  date: string
  value: number
  trend: number
}

/** Trailing N-day moving average over date-sorted points (default 7). */
export function movingAverage(
  points: { date: string; value: number }[],
  windowDays = 7,
): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((p, i) => {
    const start = Math.max(0, i - windowDays + 1)
    const slice = sorted.slice(start, i + 1)
    const avg = slice.reduce((s, x) => s + x.value, 0) / slice.length
    return { date: p.date, value: p.value, trend: avg }
  })
}
