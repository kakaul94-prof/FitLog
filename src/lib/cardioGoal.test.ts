import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CARDIO_GOAL,
  bucketForZone,
  cardioGoalMvpa,
  cardioGoalTotal,
  clampGoalMinutes,
  mvpaVerdict,
  resolveCardioGoal,
  summarizeCardioWeek,
  type CardioWeekEntry,
} from './cardioGoal'
import type { CardioGoal } from './database.types'

const simple = (light: number, heavy: number): CardioGoal => ({
  mode: 'simple',
  light,
  heavy,
  zones: [0, 0, 0, 0, 0],
})
const zoned = (zones: number[]): CardioGoal => ({
  mode: 'zones',
  light: 0,
  heavy: 0,
  zones,
})
const entry = (
  duration_min: number | null,
  zone: number | null,
): CardioWeekEntry => ({ duration_min, zone })

describe('clampGoalMinutes', () => {
  it('rounds, floors at 0, and caps', () => {
    expect(clampGoalMinutes(42.4)).toBe(42)
    expect(clampGoalMinutes(-10)).toBe(0)
    expect(clampGoalMinutes(99999)).toBe(1200)
  })

  it('reads junk as 0', () => {
    expect(clampGoalMinutes(undefined)).toBe(0)
    expect(clampGoalMinutes('abc')).toBe(0)
    expect(clampGoalMinutes(null)).toBe(0)
  })
})

describe('resolveCardioGoal', () => {
  it('is null when nothing is stored and there is no legacy target', () => {
    expect(resolveCardioGoal(null, null)).toBeNull()
    expect(resolveCardioGoal(undefined, 0)).toBeNull()
  })

  it('seeds simple mode from the legacy single target', () => {
    const g = resolveCardioGoal(null, 150)
    expect(g).toMatchObject({ mode: 'simple', light: 150, heavy: 0 })
  })

  it('normalizes a partial save', () => {
    const g = resolveCardioGoal({ mode: 'zones', zones: [30, 90] }, null)
    expect(g).toEqual({
      mode: 'zones',
      light: 0,
      heavy: 0,
      zones: [30, 90, 0, 0, 0],
    })
  })

  it('falls back to simple for an unknown mode', () => {
    expect(resolveCardioGoal({ mode: 'weekly' }, null)?.mode).toBe('simple')
  })

  it('prefers a stored goal over the legacy target', () => {
    const g = resolveCardioGoal({ mode: 'simple', light: 200, heavy: 30 }, 150)
    expect(g).toMatchObject({ light: 200, heavy: 30 })
  })
})

describe('goal totals', () => {
  it('sums the active mode only', () => {
    expect(cardioGoalTotal(simple(150, 45))).toBe(195)
    expect(cardioGoalTotal(zoned([30, 90, 25, 15, 10]))).toBe(170)
  })

  it('counts vigorous minutes double for MVPA', () => {
    expect(cardioGoalMvpa(simple(150, 45))).toBe(240)
    expect(cardioGoalMvpa(zoned([30, 90, 25, 15, 10]))).toBe(220)
  })
})

describe('bucketForZone', () => {
  it('splits at zone 3 and treats no-zone as light', () => {
    expect(bucketForZone(1)).toBe('light')
    expect(bucketForZone(2)).toBe('light')
    expect(bucketForZone(3)).toBe('heavy')
    expect(bucketForZone(5)).toBe('heavy')
    expect(bucketForZone(null)).toBe('light')
  })
})

describe('summarizeCardioWeek — simple mode', () => {
  const entries = [
    entry(60, 2),
    entry(30, 1),
    entry(28, 4),
    entry(20, null), // no HR logged
  ]

  it('folds unzoned minutes into light', () => {
    const s = summarizeCardioWeek(entries, simple(150, 45))
    expect(s.buckets.map((b) => [b.key, b.done, b.target])).toEqual([
      ['light', 110, 150],
      ['heavy', 28, 45],
    ])
    expect(s.unzoned).toBe(20)
    expect(s.totalDone).toBe(138)
    expect(s.totalTarget).toBe(195)
  })

  it('computes MVPA with heavy doubled', () => {
    const s = summarizeCardioWeek(entries, simple(150, 45))
    expect(s.mvpaDone).toBe(110 + 2 * 28)
    expect(s.mvpaTarget).toBe(240)
  })

  it('ignores entries with no duration', () => {
    const s = summarizeCardioWeek(
      [entry(null, 2), entry(0, 3), entry(15, 2)],
      simple(150, 45),
    )
    expect(s.sessions).toBe(1)
    expect(s.totalDone).toBe(15)
  })
})

describe('summarizeCardioWeek — zones mode', () => {
  it('reports each zone separately', () => {
    const s = summarizeCardioWeek(
      [entry(68, 2), entry(24, 1), entry(18, 3)],
      zoned([30, 90, 25, 15, 10]),
    )
    expect(s.buckets.map((b) => [b.key, b.done])).toEqual([
      ['z1', 24],
      ['z2', 68],
      ['z3', 18],
      ['z4', 0],
      ['z5', 0],
    ])
  })

  it('adds a no-zone row only when there are unzoned minutes', () => {
    const goal = zoned([30, 90, 25, 15, 10])
    expect(summarizeCardioWeek([entry(40, 2)], goal).buckets).toHaveLength(5)

    const s = summarizeCardioWeek([entry(40, 2), entry(25, null)], goal)
    expect(s.buckets).toHaveLength(6)
    expect(s.buckets[5]).toMatchObject({ key: 'unzoned', done: 25, target: 0 })
    // Untargeted minutes still count toward the week's total.
    expect(s.totalDone).toBe(65)
  })

  it('treats an out-of-range zone as unzoned', () => {
    const s = summarizeCardioWeek([entry(30, 9)], zoned([10, 10, 10, 10, 10]))
    expect(s.unzoned).toBe(30)
  })
})

describe('progress percentage', () => {
  it('is 0 when nothing is targeted', () => {
    expect(summarizeCardioWeek([entry(30, 2)], simple(0, 0)).pct).toBe(0)
  })

  it('can exceed 100', () => {
    expect(summarizeCardioWeek([entry(120, 2)], simple(60, 0)).pct).toBe(200)
  })
})

describe('mvpaVerdict', () => {
  it('flags under, within, and over the guideline window', () => {
    expect(mvpaVerdict(0).ok).toBe(false)
    expect(mvpaVerdict(100).ok).toBe(false)
    expect(mvpaVerdict(150).ok).toBe(true)
    expect(mvpaVerdict(300).ok).toBe(true)
    expect(mvpaVerdict(400).ok).toBe(true)
    expect(mvpaVerdict(400).text).toContain('above')
  })
})

describe('DEFAULT_CARDIO_GOAL', () => {
  it('lands inside the guideline window', () => {
    expect(mvpaVerdict(cardioGoalMvpa(DEFAULT_CARDIO_GOAL)).ok).toBe(true)
  })
})
