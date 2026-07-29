import { describe, expect, it } from 'vitest'
import {
  currentE1RM,
  estimateRoutineMinutes,
  formatPace,
  nextRoutineId,
  projectGoalEta,
  requiredPace,
  suggestNext,
  suggestNextSet,
  weightForReps,
  workoutDurationMin,
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

describe('suggestNextSet — within-session coach', () => {
  it('has nothing to say about an empty set', () => {
    expect(suggestNextSet({ weight_lb: null, reps: null })).toBeNull()
  })

  it('stops the exercise on pain, offering ~30% less to continue', () => {
    const s = suggestNextSet(
      { weight_lb: 190, reps: 5, effort: 8, pain: 'shoulder' },
      { goal: makeGoal() },
    )!
    expect(s.action).toBe('stop')
    expect(s.weightLb).toBe(135)
    expect(s.painSite).toBe('shoulder')
    expect(s.rationale).toContain('Shoulder')
  })

  it('backs off ~10% on an RPE 10 set', () => {
    const s = suggestNextSet({ weight_lb: 200, reps: 5, effort: 10 }, {
      goal: makeGoal(),
    })!
    expect(s.action).toBe('backoff')
    expect(s.weightLb).toBe(180)
  })

  it('backs off ~10% when reps fall 2+ short', () => {
    const s = suggestNextSet({ weight_lb: 200, reps: 3, effort: 8 }, {
      goal: makeGoal(),
    })!
    expect(s.action).toBe('backoff')
    expect(s.weightLb).toBe(180)
    expect(s.rationale).toContain('2 reps short')
  })

  it('backs off ~5% on RPE 9', () => {
    const s = suggestNextSet({ weight_lb: 200, reps: 5, effort: 9 }, {
      goal: makeGoal(),
    })!
    expect(s.action).toBe('backoff')
    expect(s.weightLb).toBe(190)
  })

  it('backs off ~5% when a single rep is missed', () => {
    const s = suggestNextSet({ weight_lb: 200, reps: 4, effort: 8 }, {
      goal: makeGoal(),
    })!
    expect(s.action).toBe('backoff')
    expect(s.weightLb).toBe(190)
  })

  it("holds the load when form went off, however easy it felt", () => {
    const s = suggestNextSet(
      { weight_lb: 190, reps: 5, effort: 5, feel: 'off' },
      { goal: makeGoal() },
    )!
    expect(s.action).toBe('hold')
    expect(s.weightLb).toBe(190)
    expect(s.rationale).toMatch(/no added load/)
  })

  it('adds the increment on an easy set that hit its reps', () => {
    const s = suggestNextSet(
      { weight_lb: 185, reps: 5, effort: 6, feel: 'good' },
      { goal: makeGoal() },
    )!
    expect(s.action).toBe('increase')
    expect(s.weightLb).toBe(190)
    expect(s.headline).toBe('190 × 5')
  })

  it('drops to the bottom of the range when double progression adds weight', () => {
    const s = suggestNextSet({ weight_lb: 100, reps: 8, effort: 6 }, {
      goal: makeGoal({ method: 'double' }),
    })!
    expect(s.action).toBe('increase')
    expect(s).toMatchObject({ weightLb: 105, reps: 5 })
  })

  it('holds an RPE 7–8 set that hit its reps', () => {
    const s = suggestNextSet({ weight_lb: 185, reps: 5, effort: 8 }, {
      goal: makeGoal(),
    })!
    expect(s.action).toBe('hold')
    expect(s.weightLb).toBe(185)
    expect(s.rationale).toMatch(/in the pocket/)
  })

  it('falls back to the template target with no goal', () => {
    const s = suggestNextSet(
      { weight_lb: 100, reps: 10, effort: 6 },
      { fallbackReps: 10 },
    )!
    expect(s.action).toBe('increase')
    expect(s).toMatchObject({ weightLb: 105, reps: 10 })
  })

  it('reads reps as hit when there is no target at all', () => {
    const s = suggestNextSet({ weight_lb: 100, reps: 7, effort: 8 })!
    expect(s.action).toBe('hold')
    expect(s).toMatchObject({ weightLb: 100, reps: 7 })
  })

  it('moves reps, not load, on bodyweight sets', () => {
    const easy = suggestNextSet({ weight_lb: null, reps: 12, effort: 5 })!
    expect(easy).toMatchObject({ action: 'increase', weightLb: null, reps: 13 })
    expect(easy.headline).toBe('13 reps')
    const hard = suggestNextSet({ weight_lb: null, reps: 12, effort: 10 })!
    expect(hard).toMatchObject({ action: 'backoff', weightLb: null, reps: 10 })
  })

  it('follows the 5/3/1 wave instead of autoregulating', () => {
    const goal = makeGoal({ method: '531', tm_lb: 200, week: 1 })
    // Week 1 is 65/75/85% × 5; two sets done → the 85% AMRAP set is next.
    const s = suggestNextSet({ weight_lb: 150, reps: 5, effort: 6 }, {
      goal,
      setsDone: 2,
    })!
    expect(s.weightLb).toBe(170)
    expect(s.amrap).toBe(true)
    expect(s.action).toBe('hold')
    expect(s.source).toMatch(/Wendler/)
  })

  it('lets pain and RPE 10 interrupt a 5/3/1 wave', () => {
    const goal = makeGoal({ method: '531', tm_lb: 200, week: 1 })
    const maxed = suggestNextSet({ weight_lb: 150, reps: 5, effort: 10 }, {
      goal,
      setsDone: 1,
    })!
    expect(maxed.action).toBe('backoff')
    const hurt = suggestNextSet(
      { weight_lb: 150, reps: 5, effort: 7, pain: 'knee' },
      { goal, setsDone: 1 },
    )!
    expect(hurt.action).toBe('stop')
  })

  it('has nothing left to prescribe once the 5/3/1 wave is done', () => {
    const goal = makeGoal({ method: '531', tm_lb: 200, week: 1 })
    expect(
      suggestNextSet({ weight_lb: 170, reps: 6, effort: 8 }, { goal, setsDone: 3 }),
    ).toBeNull()
  })

  it('autoregulates a 5/3/1 goal that has no training max yet', () => {
    const goal = makeGoal({ method: '531', tm_lb: null, week: 1 })
    const s = suggestNextSet({ weight_lb: 150, reps: 5, effort: 6 }, {
      goal,
      setsDone: 1,
    })!
    expect(s.action).toBe('increase')
    expect(s.weightLb).toBe(155)
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
  it('holds the weight when the last session was max effort (RPE 9)', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 9)])
    expect(s.action).toBe('repeat')
    expect(s.sets[0].weightLb).toBe(100)
    expect(s.source).toMatch(/RPE/)
  })
  it('takes a bigger jump when it felt easy (RPE <= 6)', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 5)])
    expect(s.action).toBe('increase')
    expect(s.sets[0].weightLb).toBe(110) // +1.5x the 5 lb increment
    expect(s.source).toMatch(/RPE/)
  })
  it('takes the standard jump at moderate effort and stays silent on RPE', () => {
    const s = suggestNext(makeGoal(), [sets(100, 5, 3, 7)])
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

describe('nextRoutineId', () => {
  const routines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('returns null when there are no routines', () => {
    expect(nextRoutineId([], [{ source_routine_id: 'a' }])).toBeNull()
  })
  it('starts at the first routine when nothing templated has been done', () => {
    expect(nextRoutineId(routines, [])).toBe('a')
    expect(nextRoutineId(routines, [{ source_routine_id: null }])).toBe('a')
  })
  it('advances to the next routine after the last one trained', () => {
    // workouts are newest-first
    expect(nextRoutineId(routines, [{ source_routine_id: 'a' }])).toBe('b')
  })
  it('wraps around after the last routine', () => {
    expect(nextRoutineId(routines, [{ source_routine_id: 'c' }])).toBe('a')
  })
  it('skips empty workouts and deleted templates to the most recent valid one', () => {
    const workouts = [
      { source_routine_id: null }, // empty workout (newest)
      { source_routine_id: 'gone' }, // template since deleted
      { source_routine_id: 'b' }, // most recent surviving template
    ]
    expect(nextRoutineId(routines, workouts)).toBe('c')
  })
  it('handles a single-routine rotation', () => {
    expect(nextRoutineId([{ id: 'a' }], [{ source_routine_id: 'a' }])).toBe('a')
  })
})

describe('workoutDurationMin', () => {
  it('spans from workout creation to the last set', () => {
    expect(
      workoutDurationMin('2026-07-20T10:00:00Z', [
        '2026-07-20T10:10:00Z',
        '2026-07-20T10:52:00Z',
        '2026-07-20T10:30:00Z',
      ]),
    ).toBe(52)
  })
  it('is null with no sets or a non-positive span', () => {
    expect(workoutDurationMin('2026-07-20T10:00:00Z', [])).toBeNull()
    // backfilled workout: sets logged "before" the workout row was created
    expect(
      workoutDurationMin('2026-07-20T10:00:00Z', ['2026-07-20T09:59:00Z']),
    ).toBeNull()
  })
})

describe('estimateRoutineMinutes', () => {
  it('takes the median of plausible durations, rounded to 5', () => {
    expect(estimateRoutineMinutes([48, 61, 44], [4, 4])).toBe(50)
  })
  it('averages the middle pair for an even count', () => {
    expect(estimateRoutineMinutes([40, 60], [])).toBe(50)
  })
  it('ignores implausible durations (backfills, left-open sessions)', () => {
    expect(estimateRoutineMinutes([2, 400, 52, null], [4])).toBe(50)
  })
  it('falls back to ~3 min per target set when no usable history', () => {
    // 4 + 4 + default 3 = 11 sets → 33 min → rounds to 35
    expect(estimateRoutineMinutes([2, null], [4, 4, null])).toBe(35)
  })
  it('is null with neither history nor template sets', () => {
    expect(estimateRoutineMinutes([], [])).toBeNull()
  })
})
