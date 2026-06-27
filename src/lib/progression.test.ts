import { describe, expect, it } from 'vitest'
import {
  currentE1RM,
  formatPace,
  projectGoalEta,
  requiredPace,
  suggestNext,
  weightForReps,
} from './progression'
import type { PriorSet } from './progression'
import type { StrengthGoal } from './database.types'

function makeGoal(p: Partial<StrengthGoal> = {}): StrengthGoal {
  return {
    id: 'g1',
    user_id: 'u1',
    exercise_key: 'bench',
    exercise_name: 'Bench Press',
    target_1rm_lb: 225,
    method: 'linear',
    increment_lb: 5,
    rep_low: 5,
    rep_high: 8,
    sets: 3,
    tm_lb: null,
    cycle: 1,
    week: 1,
    achieved_at: null,
    target_date: null,
    created_at: '',
    updated_at: '',
    ...p,
  }
}

// `n` identical working sets at a weight/reps, with an optional RPE.
const sets = (
  weight: number,
  reps: number,
  count: number,
  effort?: number,
): PriorSet[] =>
  Array.from({ length: count }, () => ({ weight_lb: weight, reps, effort }))

describe('weightForReps', () => {
  it('returns the target itself at 1 rep', () => {
    expect(weightForReps(200, 1)).toBe(200)
  })
  it('returns the target for non-positive input', () => {
    expect(weightForReps(0, 5)).toBe(0)
  })
  it('inverts Epley above 1 rep', () => {
    expect(weightForReps(200, 5)).toBeCloseTo(171.43, 2)
  })
})

describe('currentE1RM', () => {
  it('is 0 with no sessions', () => {
    expect(currentE1RM([])).toBe(0)
  })
  it('takes the best Epley e1RM across sessions', () => {
    expect(currentE1RM([sets(100, 5, 1), sets(135, 3, 1)])).toBe(149)
  })
  it('respects the lookback window', () => {
    // a huge 6th session is ignored at the default lookback of 5
    const sessions = [
      ...Array.from({ length: 5 }, () => sets(100, 5, 1)),
      sets(500, 1, 1),
    ]
    expect(currentE1RM(sessions)).toBe(117)
  })
})

describe('suggestNext — start state', () => {
  it('asks for a logged set when there is no history', () => {
    const s = suggestNext(makeGoal(), [])
    expect(s.action).toBe('start')
    expect(s.sets).toEqual([])
  })
  it('ignores blank prefill-only sessions', () => {
    const s = suggestNext(makeGoal(), [[{ weight_lb: null, reps: null }]])
    expect(s.action).toBe('start')
  })
})

describe('suggestNext — linear', () => {
  it('adds the increment after hitting the target', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3)])
    expect(s.action).toBe('increase')
    expect(s.sets).toHaveLength(3)
    expect(s.sets[0]).toMatchObject({ weightLb: 105, reps: 5 })
    expect(s.headline).toContain('105')
  })
  it('repeats the weight after missing reps', () => {
    const s = suggestNext(makeGoal(), [sets(100, 4, 3)])
    expect(s.action).toBe('repeat')
    expect(s.sets[0].weightLb).toBe(100)
  })
  it('deloads ~10% after stalling twice', () => {
    const s = suggestNext(makeGoal(), [sets(100, 4, 3), sets(100, 4, 3)])
    expect(s.action).toBe('deload')
    expect(s.sets[0].weightLb).toBe(90)
  })
})

describe('suggestNext — double progression', () => {
  const dbl = makeGoal({ method: 'double' })

  it('adds a rep before adding weight', () => {
    const s = suggestNext(dbl, [sets(100, 6, 3)])
    expect(s.action).toBe('repeat')
    expect(s.sets[0]).toMatchObject({ weightLb: 100, reps: 7 })
  })
  it('adds weight and drops to the bottom of the range once the top reps land', () => {
    const s = suggestNext(dbl, [sets(100, 8, 3)])
    expect(s.action).toBe('increase')
    expect(s.sets[0]).toMatchObject({ weightLb: 105, reps: 5 })
  })
})

describe('suggestNext — RPE autoregulation', () => {
  it('holds the weight when the last session was max effort (RPE 5)', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 5)])
    expect(s.action).toBe('repeat')
    expect(s.sets[0].weightLb).toBe(100)
    expect(s.source).toMatch(/RPE/)
  })
  it('takes a bigger jump when it felt easy (RPE <= 2)', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 2)])
    expect(s.action).toBe('increase')
    expect(s.sets[0].weightLb).toBe(110) // +1.5x the 5 lb increment
    expect(s.source).toMatch(/RPE/)
  })
  it('takes the standard jump at moderate effort and stays silent on RPE', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 3)])
    expect(s.action).toBe('increase')
    expect(s.sets[0].weightLb).toBe(105)
    expect(s.source).not.toMatch(/RPE/)
  })
})

describe('suggestNext — 5/3/1', () => {
  it('lays out the week-1 wave off the training max', () => {
    const s = suggestNext(makeGoal({ method: '531', tm_lb: 200, week: 1 }), [])
    expect(s.method).toBe('531')
    expect(s.sets).toHaveLength(3)
    expect(s.sets[0].weightLb).toBe(130) // 65% of 200
    expect(s.sets[2].amrap).toBe(true)
    expect(s.headline).toBe('Week 1 of 4')
  })
  it('marks week 4 as a deload with no AMRAP', () => {
    const s = suggestNext(makeGoal({ method: '531', tm_lb: 200, week: 4 }), [])
    expect(s.action).toBe('deload')
    expect(s.sets[2].amrap).toBe(false)
  })
  it('asks for a set when there is no training max or history', () => {
    const s = suggestNext(makeGoal({ method: '531', tm_lb: null }), [])
    expect(s.action).toBe('start')
  })
})

describe('requiredPace', () => {
  it('spreads the remaining gain across the weeks left', () => {
    const p = requiredPace(100, 200, 70) // 10 weeks
    expect(p.remaining).toBe(100)
    expect(p.neededPerWeek).toBeCloseTo(10, 5)
    expect(p.overdue).toBe(false)
  })
  it('is done once current meets the target', () => {
    const p = requiredPace(200, 200, 30)
    expect(p.remaining).toBe(0)
    expect(p.neededPerWeek).toBe(0)
    expect(p.overdue).toBe(false)
  })
  it('flags an overdue date with work remaining', () => {
    const p = requiredPace(150, 200, -5)
    expect(p.remaining).toBe(50)
    expect(p.overdue).toBe(true)
  })
})

describe('formatPace', () => {
  it('rounds to the nearest half pound', () => {
    expect(formatPace(2.5)).toBe('2.5')
    expect(formatPace(10)).toBe('10')
  })
  it('collapses tiny paces to "<0.5"', () => {
    expect(formatPace(0.2)).toBe('<0.5')
  })
})

describe('projectGoalEta', () => {
  it('returns no estimate with fewer than two points', () => {
    const r = projectGoalEta([{ date: '2026-06-01', e1rm: 100 }], 200)
    expect(r.etaISO).toBeNull()
    expect(r.trendingUp).toBe(false)
    expect(r.reached).toBe(false)
  })
  it('marks the goal reached when the latest point meets it', () => {
    const r = projectGoalEta(
      [
        { date: '2026-06-01', e1rm: 100 },
        { date: '2026-06-29', e1rm: 210 },
      ],
      200,
    )
    expect(r.reached).toBe(true)
    expect(r.etaISO).toBeNull()
  })
  it('projects a future date from an upward trend', () => {
    const r = projectGoalEta(
      [
        { date: '2026-06-01', e1rm: 100 },
        { date: '2026-06-29', e1rm: 128 },
      ],
      200,
    )
    expect(r.trendingUp).toBe(true)
    expect(r.slopePerWeek).toBeCloseTo(7, 5)
    expect(r.etaISO).not.toBeNull()
    expect(r.etaISO! > '2026-06-29').toBe(true)
  })
  it('gives no estimate when flat or declining', () => {
    const r = projectGoalEta(
      [
        { date: '2026-06-01', e1rm: 150 },
        { date: '2026-06-29', e1rm: 140 },
      ],
      200,
    )
    expect(r.etaISO).toBeNull()
    expect(r.trendingUp).toBe(false)
  })
})
