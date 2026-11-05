import { describe, it, expect } from 'vitest'
import {
  drinkLead,
  drinkPlan,
  formatMinutes,
  gentleDrinkMin,
  lateCaffeine,
  nextDrinkOffset,
  nextOffset,
  recordDrinkFeedback,
  stomachShare,
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

// 400 kcal mixed meal: window 80–160 min, best 105 (see above).
const mixed = () => win({ kcal: 400, carb: 60, protein: 30, fat: 5, fiber: 4 })
const stim = { caffeineMg: 200, carbG: 0 }

describe('stomachShare', () => {
  it('falls from all → half at the window open → none at its close', () => {
    const w = mixed()
    expect([0, 40, 80, 120, 160, 200].map((m) => stomachShare(w, m))).toEqual([1, 0.75, 0.5, 0.25, 0, 0])
    expect(stomachShare(w, -10)).toBe(0) // drank before eating
  })
})

describe('drinkLead', () => {
  it('runs 25 min on an empty stomach to 45 once it is half full or more', () => {
    expect([drinkLead(0), drinkLead(0.25), drinkLead(0.5), drinkLead(1)]).toEqual([25, 35, 45, 45])
  })

  it('adds your offset inside 15–75 min', () => {
    expect(drinkLead(0.5, 10)).toBe(55)
    expect(drinkLead(0, -20)).toBe(15)
    expect(drinkLead(1, 40)).toBe(75)
  })
})

describe('drinkPlan', () => {
  it('plans the drink no earlier than half-digested, kick inside the window', () => {
    const p = drinkPlan(mixed(), stim)
    expect([p.drinkMin, p.leadMin, p.kickStartMin, p.kickEndMin]).toEqual([80, 45, 125, 170])
    expect(p.startMin).toEqual([125, 160])
    expect(p.fullStomach).toBe(false)
    expect(p.miss).toBeNull()
  })

  it("never plans in the past: drinking later shortens the lead and can miss the window's end", () => {
    const p = drinkPlan(mixed(), stim, { notBeforeMin: 131 })
    expect([p.drinkMin, p.leadMin, p.kickStartMin]).toEqual([135, 30, 165])
    expect(p.startMin).toBeNull()
    expect(p.miss).toBe('late')
  })

  it('lets carbs in the drink carry you past the meal window', () => {
    const p = drinkPlan(mixed(), { caffeineMg: 200, carbG: 20 }, { notBeforeMin: 131 })
    expect(p.topsUp).toBe(true)
    expect(p.startMin).toEqual([165, 210])
    expect(p.reasons.some((r) => r.includes('20 g carbs'))).toBe(true)
  })

  it('flags a drink taken on a full stomach and starts at the overlap', () => {
    const p = drinkPlan(mixed(), stim, { drankMin: 30 })
    expect([p.leadMin, p.kickStartMin, p.kickEndMin]).toEqual([45, 75, 120])
    expect(p.fullStomach).toBe(true)
    expect(p.startMin).toEqual([80, 120])
    expect(p.reasons[0]).toContain('81% left')
  })

  it('says which way the kick misses', () => {
    const p = drinkPlan(mixed(), stim, { drankMin: -60 })
    expect([p.leadMin, p.kickEndMin]).toEqual([25, 10])
    expect(p.miss).toBe('early')
  })

  it('applies your drink offset', () => {
    const p = drinkPlan(mixed(), stim, { drankMin: 30, offsetMin: 10 })
    expect([p.leadMin, p.kickStartMin]).toEqual([55, 85])
    expect(p.reasons).toContain('Drink timing tuned to your feedback: +10 min')
  })

  it('suggests drinking once the meal is half gone', () => {
    expect(gentleDrinkMin(mixed())).toBe(80)
  })
})

describe('lateCaffeine', () => {
  it('notes caffeine from 4 pm on, one half-life later', () => {
    expect(lateCaffeine(new Date(2026, 10, 4, 17, 0), 200)?.getHours()).toBe(22)
    expect(lateCaffeine(new Date(2026, 10, 4, 15, 59), 200)).toBeNull()
    expect(lateCaffeine(new Date(2026, 10, 4, 17, 0), 0)).toBeNull()
  })
})

describe('nextDrinkOffset', () => {
  it('moves only on feedback that contradicts the lead', () => {
    expect(nextDrinkOffset(0, 'not-yet', 50, 45)).toBe(10)
    expect(nextDrinkOffset(0, 'not-yet', 30, 45)).toBe(0) // started before the lead was up
    expect(nextDrinkOffset(0, 'fading', 60, 45)).toBe(-10)
    expect(nextDrinkOffset(0, 'fading', 100, 45)).toBe(0) // waited past the kick
    expect(nextDrinkOffset(0, 'right', 50, 45)).toBe(0)
    expect(nextDrinkOffset(30, 'not-yet', 60, 45)).toBe(30) // capped
  })
})

describe('drink feedback flow', () => {
  const prefs = { on: true, caffeineMg: 200, carbG: 0 }
  const taken = { at: '2026-10-07T13:00:00Z', caffeineMg: 200, carbG: 0, leadMin: 45 }
  const base = (drink: typeof taken | null) =>
    rememberFuelMeal({ offsetMin: 0, log: [], last: null, drinkOffsetMin: -10 }, '2026-10-07T12:00:00Z', ['e1'], mixed(), prefs, drink)

  it('remembers your usual drink and keeps the learned offset', () => {
    const s = base(taken)
    expect(s.drink).toEqual(prefs)
    expect(s.drinkOffsetMin).toBe(-10)
    expect(s.last?.drink).toEqual(taken)
  })

  it('keeps the meal pending until both questions are answered, in either order', () => {
    const mealFirst = recordFuelFeedback(base(taken), 'fine', 100, '2026-10-07')!
    expect(mealFirst.last?.mealRated).toBe(true)
    expect(pendingFuelMeal(mealFirst, '2026-10-07T13:50:00Z')).toBe(mealFirst.last)
    const done = recordDrinkFeedback(mealFirst, 'not-yet', 50)!
    expect(done.drinkOffsetMin).toBe(0)
    expect(done.last).toBeNull()

    const drinkFirst = recordDrinkFeedback(base(taken), 'right', 50)!
    expect(drinkFirst.last?.drink?.rated).toBe(true)
    expect(recordFuelFeedback(drinkFirst, 'fine', 100, '2026-10-07')!.last).toBeNull()
  })

  it('asks nothing about a drink that was only planned', () => {
    const planned = base({ ...taken, at: null })
    expect(recordFuelFeedback(planned, 'fine', 100, '2026-10-07')!.last).toBeNull()
    expect(recordDrinkFeedback(planned, 'right', 50)).toBe(planned)
  })
})
