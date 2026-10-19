import { describe, it, expect } from 'vitest'
import {
  formatMinutes,
  nextOffset,
  pendingFuelMeal,
  preWorkoutWindow,
  recordFuelFeedback,
  rememberFuelMeal,
} from './fuel'
import type { FuelTimingState, Nutrients } from './database.types'

const meal = (n: Nutrients, servings = 1) => [{ nutrients: n, servings }]
const win = (n: Nutrients, offset = 0) => preWorkoutWindow(meal(n), offset)!

describe('preWorkoutWindow', () => {
  it('returns null for nothing with calories', () => {
    expect(preWorkoutWindow([], 0)).toBeNull()
    expect(preWorkoutWindow(meal({ kcal: 0, fiber: 0 }))).toBeNull()
  })

  it('times a snack at half → fully emptied (~2.5 kcal/min)', () => {
    const w = win({ kcal: 150, carb: 30, protein: 5, fat: 2, fiber: 2 })
    expect([w.earliestMin, w.bestMin, w.latestMin]).toEqual([30, 40, 60])
    expect(w.flags).toEqual([])
  })

  it('times a mixed meal inside the 1–4 h guideline', () => {
    const w = win({ kcal: 400, carb: 60, protein: 30, fat: 5, fiber: 4 })
    expect([w.earliestMin, w.bestMin, w.latestMin]).toEqual([80, 105, 160])
    const big = win({ kcal: 600, carb: 80, protein: 40, fat: 13, fiber: 5 })
    expect([big.earliestMin, big.latestMin]).toEqual([120, 240])
  })

  it('scales per-serving nutrients by servings', () => {
    const w = preWorkoutWindow(meal({ kcal: 200, carb: 30, protein: 15, fat: 2.5, fiber: 2 }, 2))!
    expect([w.kcal, w.earliestMin, w.latestMin]).toEqual([400, 80, 160])
  })

  it('pushes later for fat share and fiber, with reasons', () => {
    const fatty = win({ kcal: 400, carb: 30, protein: 20, fat: 25, fiber: 3 }) // 56% fat
    expect([fatty.earliestMin, fatty.latestMin]).toEqual([110, 190])
    expect(fatty.flags).toContain('gi-risk')
    expect(fatty.reasons.some((r) => r.startsWith('High fat (56%'))).toBe(true)
    expect(win({ kcal: 400, carb: 40, protein: 20, fat: 17, fiber: 3 }).earliestMin).toBe(95) // 38% → +15
    expect(win({ kcal: 400, carb: 60, protein: 20, fat: 5, fiber: 10 }).earliestMin).toBe(95)
    const fibrous = win({ kcal: 400, carb: 60, protein: 20, fat: 5, fiber: 16 })
    expect(fibrous.earliestMin).toBe(110)
    expect(fibrous.flags).toContain('gi-risk')
  })

  it('caps a very large meal at the guideline and flags it', () => {
    const w = win({ kcal: 1200, carb: 150, protein: 60, fat: 30, fiber: 5 })
    expect([w.earliestMin, w.bestMin, w.latestMin]).toEqual([210, 220, 240])
    expect(w.flags).toContain('large')
    expect(w.reasons).toContain('Held inside the 1–4 h pre-exercise guideline')
  })

  it('floors a tiny snack and flags it light / low-carb', () => {
    const w = win({ kcal: 60, carb: 15, protein: 0, fat: 0, fiber: 0 })
    expect([w.earliestMin, w.latestMin]).toEqual([15, 45])
    expect(w.flags).toEqual(['light', 'low-carb'])
  })

  it('flags foods with no fiber data', () => {
    const w = preWorkoutWindow([
      { nutrients: { kcal: 200, carb: 30, fiber: 3 }, servings: 1 },
      { nutrients: { kcal: 200, carb: 30 }, servings: 1 },
    ])!
    expect(w.flags).toContain('fiber-missing')
  })

  it('shifts by the personal offset without going under the floor', () => {
    const later = win({ kcal: 400, carb: 60, protein: 30, fat: 5, fiber: 4 }, 30)
    expect([later.earliestMin, later.latestMin]).toEqual([110, 190])
    expect(later.reasons).toContain('Tuned to your feedback: +30 min')
    const earlier = win({ kcal: 150, carb: 30, protein: 5, fat: 2, fiber: 2 }, -60)
    expect([earlier.earliestMin, earlier.latestMin]).toEqual([15, 45])
  })
})

describe('feedback calibration', () => {
  const last = { earliestMin: 80, latestMin: 160 }
  it('only moves on feedback that contradicts the window', () => {
    expect(nextOffset(0, 'heavy', 100, last)).toBe(15)
    expect(nextOffset(0, 'heavy', 60, last)).toBe(0) // trained early: window was right
    expect(nextOffset(0, 'flat', 120, last)).toBe(-15)
    expect(nextOffset(0, 'flat', 200, last)).toBe(0) // trained late: window was right
    expect(nextOffset(15, 'fine', 100, last)).toBe(15)
    expect(nextOffset(60, 'heavy', 100, last)).toBe(60)
    expect(nextOffset(-60, 'flat', 100, last)).toBe(-60)
  })

  it('remembers a meal, then records feedback and clears it', () => {
    const w = win({ kcal: 400, carb: 60, protein: 30, fat: 5, fiber: 4 })
    const s = rememberFuelMeal(null, '2026-10-07T12:00:00Z', ['e1'], w)
    expect(s.last).toEqual({ ateAt: '2026-10-07T12:00:00Z', entryIds: ['e1'], kcal: 400, earliestMin: 80, latestMin: 160 })
    const after = recordFuelFeedback(s, 'heavy', 95.4, '2026-10-07')!
    expect(after.offsetMin).toBe(15)
    expect(after.last).toBeNull()
    expect(after.log).toEqual([{ date: '2026-10-07', feel: 'heavy', gapMin: 95, kcal: 400 }])
    expect(recordFuelFeedback(after, 'fine', 90, '2026-10-08')).toBe(after) // nothing pending
  })

  it('prunes the log to 30', () => {
    const log = Array.from({ length: 30 }, (_, i) => ({ date: `d${i}`, feel: 'fine' as const, gapMin: 90, kcal: 400 }))
    const s: FuelTimingState = { offsetMin: 0, log, last: { ateAt: 'x', entryIds: [], kcal: 300, earliestMin: 60, latestMin: 120 } }
    const after = recordFuelFeedback(s, 'fine', 90, 'new')!
    expect(after.log).toHaveLength(30)
    expect(after.log[29].date).toBe('new')
  })

  it('asks about a meal only for a workout 0–6 h after it', () => {
    const s: FuelTimingState = {
      offsetMin: 0,
      log: [],
      last: { ateAt: '2026-10-07T12:00:00Z', entryIds: [], kcal: 400, earliestMin: 80, latestMin: 160 },
    }
    expect(pendingFuelMeal(s, '2026-10-07T13:30:00Z')).toBe(s.last)
    expect(pendingFuelMeal(s, '2026-10-07T11:00:00Z')).toBeNull()
    expect(pendingFuelMeal(s, '2026-10-07T19:00:00Z')).toBeNull()
    expect(pendingFuelMeal(null, '2026-10-07T13:30:00Z')).toBeNull()
  })
})

describe('formatMinutes', () => {
  it('formats minutes and hours', () => {
    expect([formatMinutes(45), formatMinutes(60), formatMinutes(96)]).toEqual(['45 min', '1 h', '1 h 36 min'])
  })
})
