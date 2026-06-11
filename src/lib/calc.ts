import type {
  ActivityLevel,
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

// ---------- exercise calories ----------
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
