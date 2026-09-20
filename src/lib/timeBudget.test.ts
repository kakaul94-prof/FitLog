import { describe, it, expect } from 'vitest'
import {
  MIN_SETS,
  minutesPerSet,
  trimToBudget,
  trimSummary,
  type BudgetItem,
} from './timeBudget'

const item = (
  id: string,
  sets: number | null,
  isOptional = false,
): BudgetItem => ({ id, name: id, sets, isOptional })

/** The worked example: Push Day, 4/3/3 core + 3/3/3 optional = 19 sets,
 *  measured at ~51 min (≈2.68 min per set). */
const pushDay: BudgetItem[] = [
  item('bench', 4),
  item('incline', 3),
  item('ohp', 3),
  item('fly', 3, true),
  item('lateral', 3, true),
  item('pushdown', 3, true),
]
const PER = 51 / 19

const kept = (r: ReturnType<typeof trimToBudget>) =>
  Object.fromEntries(r.items.map((i) => [i.id, i.keptSets]))

describe('minutesPerSet', () => {
  it('divides the measured estimate by the template sets', () => {
    expect(minutesPerSet(60, 20)).toBe(3)
  })
  it('is null without usable data', () => {
    expect(minutesPerSet(null, 20)).toBeNull()
    expect(minutesPerSet(0, 20)).toBeNull()
    expect(minutesPerSet(60, 0)).toBeNull()
  })
})

describe('trimToBudget', () => {
  it('leaves the session alone with no budget', () => {
    const r = trimToBudget(pushDay, null, PER)
    expect(r.untouched).toBe(true)
    expect(r.totalSets).toBe(19)
    expect(r.fits).toBe(true)
  })

  it('leaves the session alone with no per-set estimate', () => {
    const r = trimToBudget(pushDay, 30, null)
    expect(r.untouched).toBe(true)
    expect(r.totalSets).toBe(19)
  })

  it('leaves the session alone when the budget already covers it', () => {
    const r = trimToBudget(pushDay, 60, PER)
    expect(r.untouched).toBe(true)
    expect(r.estMinutes).toBe(51)
  })

  it('fits Push Day into 30 minutes by cutting only optional work', () => {
    const r = trimToBudget(pushDay, 30, PER)
    // Core is untouched; all three optional lifts are gone.
    expect(kept(r)).toEqual({
      bench: 4,
      incline: 3,
      ohp: 3,
      fly: 0,
      lateral: 0,
      pushdown: 0,
    })
    expect(r.totalSets).toBe(10)
    expect(r.estMinutes).toBe(27)
    expect(r.fullMinutes).toBe(51)
    expect(r.fits).toBe(true)
    expect(r.untouched).toBe(false)
    expect(trimSummary(r)).toBe('3 exercises · 10 sets')
  })

  it('shaves optional sets before dropping anything', () => {
    // 45 min ≈ 16 sets: three sets come off the optional lifts, nothing drops.
    const r = trimToBudget(pushDay, 45, PER)
    expect(kept(r)).toEqual({
      bench: 4,
      incline: 3,
      ohp: 3,
      fly: 2,
      lateral: 2,
      pushdown: 2,
    })
    expect(r.items.every((i) => i.keptSets > 0)).toBe(true)
  })

  it('shaves from the bottom of the routine on a tie', () => {
    // 3 optional lifts at 3 sets, room for one cut — the last one gives.
    const r = trimToBudget(
      [item('a', 3, true), item('b', 3, true), item('c', 3, true)],
      8,
      1,
    )
    expect(kept(r)).toEqual({ a: 3, b: 3, c: 2 })
  })

  it('only shaves core lifts once the optional work is gone', () => {
    // 20 min leaves room for 7 sets, so the core gives up three of its ten.
    const r = trimToBudget(pushDay, 20, PER)
    expect(kept(r)).toEqual({
      bench: 3,
      incline: 2,
      ohp: 2,
      fly: 0,
      lateral: 0,
      pushdown: 0,
    })
    expect(r.totalSets).toBe(7)
  })

  it('never drops a core lift or shaves below the floor', () => {
    const r = trimToBudget(pushDay, 5, PER)
    expect(kept(r)).toEqual({
      bench: MIN_SETS,
      incline: MIN_SETS,
      ohp: MIN_SETS,
      fly: 0,
      lateral: 0,
      pushdown: 0,
    })
    // Bottomed out and still over budget — the screen says so.
    expect(r.fits).toBe(false)
    expect(r.totalSets).toBe(6)
  })

  it('reads a missing target as 3 sets', () => {
    const r = trimToBudget([item('a', null)], null, 2)
    expect(r.items[0].sets).toBe(3)
    expect(r.fullMinutes).toBe(6)
  })

  it('handles an empty routine', () => {
    const r = trimToBudget([], 30, 3)
    expect(r.totalSets).toBe(0)
    expect(r.fits).toBe(true)
    expect(trimSummary(r)).toBe('0 exercises · 0 sets')
  })
})
