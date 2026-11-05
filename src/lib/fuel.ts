import type { DrinkHit, FuelDrink, FuelDrinkPrefs, FuelFeel, FuelTimingState, Nutrients } from './database.types'
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

/**
 * Save the timed meal. `prefs` (your usual drink) is remembered whenever given;
 * `drink` is today's drink with this meal, or null for none.
 */
export function rememberFuelMeal(
  state: FuelTimingState | null,
  ateAt: string,
  entryIds: string[],
  w: FuelWindow,
  prefs?: FuelDrinkPrefs,
  drink?: FuelDrink | null,
): FuelTimingState {
  return {
    ...(state ?? {}),
    offsetMin: state?.offsetMin ?? 0,
    log: state?.log ?? [],
    ...(prefs ? { drink: prefs } : {}),
    last: {
      ateAt,
      entryIds,
      kcal: Math.round(w.kcal),
      earliestMin: w.earliestMin,
      latestMin: w.latestMin,
      ...(drink ? { drink } : {}),
    },
  }
}

// The meal stays pending while a drink you actually took is still unrated,
// so both questions can be answered in either order.
export function recordFuelFeedback(
  state: FuelTimingState | null,
  feel: FuelFeel,
  gapMin: number,
  date: string,
): FuelTimingState | null {
  if (!state?.last) return state
  const drinkOpen = !!state.last.drink?.at && !state.last.drink.rated
  return {
    ...state,
    offsetMin: nextOffset(state.offsetMin, feel, gapMin, state.last),
    last: drinkOpen ? { ...state.last, mealRated: true } : null,
    log: [...state.log, { date, feel, gapMin: Math.round(gapMin), kcal: state.last.kcal }].slice(-LOG_CAP),
  }
}

// ── Pre-workout drink ────────────────────────────────────────────────────────
// Caffeine peaks in the blood ~30–60 min after drinking. Food in the stomach
// slows absorption (same total, later and flatter peak), so the lead grows
// with how much of the meal is still there. Caffeine barely changes how fast
// the meal empties, so the meal window itself is left alone. Liquid carbs
// clear fast and top you up, so with enough of them the meal window's late
// ("hungry/flat") end stops mattering. A stim plus a big drink on a still-full
// stomach is a common nausea trigger: the plan never puts the drink there,
// and a drink you actually took there gets a warning. Like the meal window,
// these are comfort estimates, not a performance prescription.

export const DRINK_LEAD_EMPTY_MIN = 25
export const DRINK_LEAD_FED_MIN = 45
/** How long the kick is treated as "on" once it lands. */
export const KICK_SPAN_MIN = 45
export const DRINK_STEP_MIN = 10
export const MAX_DRINK_OFFSET_MIN = 30
const DRINK_LEAD_FLOOR_MIN = 15
const DRINK_LEAD_CAP_MIN = 75
/** Past this share of the meal still in the stomach, it counts as full. */
export const FULL_STOMACH_SHARE = 0.5
export const CARB_TOPUP_G = 15
/** Caffeine from this hour on gets the sleep note. */
export const LATE_CAFFEINE_HOUR = 16
export const CAFFEINE_HALF_LIFE_H = 5
const MIN_OVERLAP_MIN = 10

type WindowEdges = Pick<FuelWindow, 'earliestMin' | 'latestMin'>

/**
 * Share of the meal still in the stomach `min` minutes after eating (0–1):
 * all of it at 0, half when the window opens, none when it closes, so it
 * agrees with the window shown. Before the meal there's nothing there.
 */
export function stomachShare(w: WindowEdges, min: number): number {
  if (min < 0) return 0
  const { earliestMin: e, latestMin: l } = w
  if (min <= e) return 1 - (0.5 * min) / e
  return Math.max(0, 0.5 * (1 - (min - e) / (l - e)))
}

/** Minutes after eating when the stomach share falls to `share`. */
function minAtShare(w: WindowEdges, share: number): number {
  const { earliestMin: e, latestMin: l } = w
  return share >= 0.5 ? (e * (1 - share)) / 0.5 : e + (l - e) * (1 - share / 0.5)
}

/** Drink → kick lead for a given stomach share, plus your personal offset. */
export function drinkLead(share: number, offsetMin = 0): number {
  const fed = Math.min(1, share / FULL_STOMACH_SHARE)
  const base = round5(DRINK_LEAD_EMPTY_MIN + (DRINK_LEAD_FED_MIN - DRINK_LEAD_EMPTY_MIN) * fed)
  return clamp(base + offsetMin, DRINK_LEAD_FLOOR_MIN, DRINK_LEAD_CAP_MIN)
}

export interface DrinkInput {
  caffeineMg: number
  carbG: number
}

export interface DrinkPlan {
  /** All times in minutes after the meal. */
  drinkMin: number
  leadMin: number
  kickStartMin: number
  kickEndMin: number
  /** Share of the meal still in the stomach at drink time, 0–1. */
  stomachShare: number
  /** Drank on a stomach more than half full. */
  fullStomach: boolean
  /** Enough carbs that training past the meal window is fine. */
  topsUp: boolean
  /** When to start: the kick, inside the meal window. null when they miss. */
  startMin: [number, number] | null
  /** Which way the kick misses the meal window, when it does. */
  miss: 'early' | 'late' | null
  reasons: string[]
}

/**
 * Time the drink against the meal window `w`. With `drankMin` it's the drink
 * you took; without, it's planned so the kick lands at the window's best time,
 * but never on a still-full stomach or before `notBeforeMin` (now).
 */
export function drinkPlan(
  w: FuelWindow,
  drink: DrinkInput,
  opts: { drankMin?: number | null; notBeforeMin?: number; offsetMin?: number } = {},
): DrinkPlan {
  const offset = opts.offsetMin ?? 0
  const leadAt = (m: number) => drinkLead(stomachShare(w, m), offset)
  let drinkMin: number
  if (opts.drankMin != null) {
    drinkMin = opts.drankMin
  } else {
    // The lead depends on when you drink, which depends on the lead: two
    // passes settle it to the nearest 5 min.
    const guess = w.bestMin - leadAt(w.bestMin - DRINK_LEAD_FED_MIN)
    const aim = w.bestMin - leadAt(guess)
    const floor = Math.max(minAtShare(w, FULL_STOMACH_SHARE), opts.notBeforeMin ?? -Infinity)
    drinkMin = Math.ceil(Math.max(aim, floor) / 5) * 5
  }
  const share = stomachShare(w, drinkMin)
  const leadMin = leadAt(drinkMin)
  const kickStartMin = drinkMin + leadMin
  const kickEndMin = kickStartMin + KICK_SPAN_MIN
  const topsUp = drink.carbG >= CARB_TOPUP_G
  const lo = Math.max(w.earliestMin, kickStartMin)
  const hi = Math.min(topsUp ? kickEndMin : w.latestMin, kickEndMin)
  const startMin: [number, number] | null = hi - lo >= MIN_OVERLAP_MIN ? [lo, hi] : null
  const miss = startMin ? null : kickEndMin < w.earliestMin + MIN_OVERLAP_MIN ? 'early' : 'late'

  const pct = Math.round(share * 100)
  const reasons: string[] = []
  if (share >= 0.4) {
    reasons.push(`Meal still digesting (~${pct}% left), so it kicks in after ~${leadMin} min (empty stomach: ${DRINK_LEAD_EMPTY_MIN})`)
  } else if (share > 0.1) {
    reasons.push(`Meal mostly digested (~${pct}% left), so it kicks in after ~${leadMin} min`)
  } else {
    reasons.push(`Stomach about empty, so it kicks in fast: ~${leadMin} min`)
  }
  if (offset) reasons.push(`Drink timing tuned to your feedback: ${offset > 0 ? '+' : '−'}${Math.abs(offset)} min`)
  if (drink.carbG > 0) {
    reasons.push(
      topsUp
        ? `${Math.round(drink.carbG)} g carbs in the drink top you up, so training past the meal window is fine`
        : `${Math.round(drink.carbG)} g carbs in the drink: a small top-up`,
    )
  }
  return { drinkMin, leadMin, kickStartMin, kickEndMin, stomachShare: share, fullStomach: share > FULL_STOMACH_SHARE, topsUp, startMin, miss, reasons }
}

/** When to drink for a gentler stomach: once the meal is half gone. */
export function gentleDrinkMin(w: WindowEdges): number {
  return minAtShare(w, FULL_STOMACH_SHARE)
}

/**
 * For caffeine from 4 pm on: when half of it is still in you (one half-life
 * later), for the sleep note. null for earlier or caffeine-free drinks.
 */
export function lateCaffeine(drinkAt: Date, caffeineMg: number): Date | null {
  if (caffeineMg <= 0 || drinkAt.getHours() < LATE_CAFFEINE_HOUR) return null
  return new Date(drinkAt.getTime() + CAFFEINE_HALF_LIFE_H * 3_600_000)
}

// Only feedback that contradicts the lead moves it: "not yet" after waiting
// the full lead = your kick comes slower; "fading" while it should still be
// on = it comes faster.
export function nextDrinkOffset(offsetMin: number, hit: DrinkHit, gapMin: number, leadMin: number): number {
  let step = 0
  if (hit === 'not-yet' && gapMin >= leadMin) step = DRINK_STEP_MIN
  else if (hit === 'fading' && gapMin <= leadMin + KICK_SPAN_MIN) step = -DRINK_STEP_MIN
  return clamp(offsetMin + step, -MAX_DRINK_OFFSET_MIN, MAX_DRINK_OFFSET_MIN)
}

/** Answer "how did the pre-workout hit"; `gapMin` = drink → workout start. */
export function recordDrinkFeedback(
  state: FuelTimingState | null,
  hit: DrinkHit,
  gapMin: number,
): FuelTimingState | null {
  const d = state?.last?.drink
  if (!state?.last || !d?.at || d.rated) return state
  return {
    ...state,
    drinkOffsetMin: nextDrinkOffset(state.drinkOffsetMin ?? 0, hit, gapMin, d.leadMin),
    last: state.last.mealRated ? null : { ...state.last, drink: { ...d, rated: true } },
  }
}
