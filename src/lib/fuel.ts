import type { FuelFeel, FuelTimingState, Nutrients } from './database.types'
import { scaleNutrients, sumNutrients } from './nutrients'

// Pre-workout fuel window: how long after eating to train, for COMFORT.
//
// Core model: the stomach hands energy on to the gut at a roughly regulated
// rate, ~2–3 kcal/min for mixed meals (Hunt & Stubbs 1975; Brener et al. 1983),
// so emptying time scales with the meal's calories. The window opens at ~half
// emptied and closes at ~fully emptied, then is held inside the 1–4 h
// pre-exercise guideline (ACSM/AND/DC 2016; small snacks may sit closer).
// Fat and viscous fiber slow emptying beyond their calories: those two nudges
// are small, labelled ESTIMATES, not fitted values. Individual emptying rates
// vary by ±30–50%, so a personal offset learned from post-workout feedback
// shifts the whole window. Fed-vs-fasted barely moves lifting performance —
// this is a comfort guide, not a performance prescription.

export const EMPTY_KCAL_PER_MIN = 2.5
const FLOOR_MIN = 15 // never "train right now" after real food
const EARLIEST_CAP_MIN = 210 // guideline: big meals 3–4 h before
const LATEST_CAP_MIN = 240 // past 4 h the meal isn't really "pre-workout"
const MIN_SPAN_MIN = 30
export const FEEL_STEP_MIN = 15
export const MAX_OFFSET_MIN = 60
const PENDING_MAX_MIN = 360 // a workout 6 h+ after eating isn't about that meal
const LOG_CAP = 30

export type FuelFlag = 'light' | 'low-carb' | 'gi-risk' | 'large' | 'fiber-missing'

export interface FuelEntry {
  /** Per serving, as snapshotted on the diary entry. */
  nutrients: Nutrients
  servings: number
}

export interface FuelWindow {
  kcal: number
  carb: number
  protein: number
  fat: number
  fiber: number
  /** Minutes after eating. */
  earliestMin: number
  bestMin: number
  latestMin: number
  /** Why the window landed where it did, in plain words. */
  reasons: string[]
  flags: FuelFlag[]
}

export type FuelStatus =
  | { kind: 'wait'; min: number }
  | { kind: 'open'; min: number }
  | { kind: 'passed'; min: number }

const round5 = (m: number) => Math.round(m / 5) * 5
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function formatMinutes(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

export function preWorkoutWindow(entries: FuelEntry[], offsetMin = 0): FuelWindow | null {
  const total = sumNutrients(entries.map((e) => scaleNutrients(e.nutrients, e.servings)))
  const kcal = total.kcal ?? 0
  if (kcal <= 0) return null
  const carb = total.carb ?? 0
  const protein = total.protein ?? 0
  const fat = total.fat ?? 0
  const fiber = total.fiber ?? 0
  const reasons: string[] = []
  const flags: FuelFlag[] = []

  const emptyMin = kcal / EMPTY_KCAL_PER_MIN
  reasons.push(`${Math.round(kcal)} kcal at ~${EMPTY_KCAL_PER_MIN} kcal/min ≈ ${formatMinutes(emptyMin)} to digest`)
  let earliest = emptyMin / 2
  let latest = emptyMin

  // Estimates: each slows emptying past what its calories alone explain.
  const fatShare = (fat * 9) / kcal
  const fatSlow = fatShare > 0.5 ? 30 : fatShare > 0.35 ? 15 : 0
  if (fatSlow) reasons.push(`High fat (${Math.round(fatShare * 100)}% of calories) slows digestion: +${fatSlow} min`)
  const fiberSlow = fiber >= 15 ? 30 : fiber >= 8 ? 15 : 0
  if (fiberSlow) reasons.push(`High fiber (${Math.round(fiber)} g) slows digestion: +${fiberSlow} min`)
  earliest += fatSlow + fiberSlow
  latest += fatSlow + fiberSlow

  if (earliest > EARLIEST_CAP_MIN || latest > LATEST_CAP_MIN) reasons.push('Held inside the 1–4 h pre-exercise guideline')
  earliest = clamp(earliest, FLOOR_MIN, EARLIEST_CAP_MIN)
  latest = Math.max(earliest + MIN_SPAN_MIN, Math.min(latest, LATEST_CAP_MIN))

  if (offsetMin) {
    earliest = Math.max(FLOOR_MIN, earliest + offsetMin)
    latest = Math.max(earliest + MIN_SPAN_MIN, latest + offsetMin)
    reasons.push(`Tuned to your feedback: ${offsetMin > 0 ? '+' : '−'}${Math.abs(offsetMin)} min`)
  }

  if (kcal < 100) flags.push('light')
  if (carb < 20) flags.push('low-carb')
  if (fatShare > 0.5 || fiber >= 15) flags.push('gi-risk')
  if (kcal > 1000) flags.push('large')
  if (entries.some((e) => typeof e.nutrients.fiber !== 'number')) flags.push('fiber-missing')

  earliest = round5(earliest)
  latest = round5(latest)
  // A third of the way in ≈ two-thirds emptied: settled, still fuelled.
  const bestMin = round5(earliest + (latest - earliest) / 3)
  return { kcal, carb, protein, fat, fiber, earliestMin: earliest, bestMin, latestMin: latest, reasons, flags }
}

export function gapMinutes(fromISO: string, toISO: string): number {
  return (new Date(toISO).getTime() - new Date(fromISO).getTime()) / 60000
}

export function windowStatus(ateAt: string, w: Pick<FuelWindow, 'earliestMin' | 'latestMin'>, nowISO: string): FuelStatus {
  const since = gapMinutes(ateAt, nowISO)
  if (since < w.earliestMin) return { kind: 'wait', min: Math.ceil(w.earliestMin - since) }
  if (since <= w.latestMin) return { kind: 'open', min: Math.floor(w.latestMin - since) }
  return { kind: 'passed', min: Math.floor(since - w.latestMin) }
}

/** The timed meal a workout started at `startedAt` should ask about, or null. */
export function pendingFuelMeal(state: FuelTimingState | null, startedAt: string): FuelTimingState['last'] {
  const last = state?.last
  if (!last) return null
  const gap = gapMinutes(last.ateAt, startedAt)
  return gap >= 0 && gap <= PENDING_MAX_MIN ? last : null
}

// Only feedback that contradicts the window moves it: heavy after waiting
// until it opened = you empty slower; flat before it closed = you empty
// faster. Heavy after training early (or flat after training late) is the
// window being right, so it doesn't count.
export function nextOffset(
  offsetMin: number,
  feel: FuelFeel,
  gapMin: number,
  last: { earliestMin: number; latestMin: number },
): number {
  let step = 0
  if (feel === 'heavy' && gapMin >= last.earliestMin) step = FEEL_STEP_MIN
  else if (feel === 'flat' && gapMin <= last.latestMin) step = -FEEL_STEP_MIN
  return clamp(offsetMin + step, -MAX_OFFSET_MIN, MAX_OFFSET_MIN)
}

export function rememberFuelMeal(
  state: FuelTimingState | null,
  ateAt: string,
  entryIds: string[],
  w: FuelWindow,
): FuelTimingState {
  return {
    offsetMin: state?.offsetMin ?? 0,
    log: state?.log ?? [],
    last: { ateAt, entryIds, kcal: Math.round(w.kcal), earliestMin: w.earliestMin, latestMin: w.latestMin },
  }
}

export function recordFuelFeedback(
  state: FuelTimingState | null,
  feel: FuelFeel,
  gapMin: number,
  date: string,
): FuelTimingState | null {
  if (!state?.last) return state
  return {
    offsetMin: nextOffset(state.offsetMin, feel, gapMin, state.last),
    last: null,
    log: [...state.log, { date, feel, gapMin: Math.round(gapMin), kcal: state.last.kcal }].slice(-LOG_CAP),
  }
}
