import { describe, expect, it } from 'vitest'
import {
  cycleCounts,
  currentProgramIndex,
  deloadActive,
  nextProgramRoutineId,
  programRoutineIds,
  programWorkoutCount,
  upcomingProgramRoutineIds,
} from './program'
import type { ProgramItem } from './database.types'

const R = (routineId: string): ProgramItem => ({
  id: `i-${routineId}`,
  kind: 'routine',
  routineId,
})
const REST = (n = 0): ProgramItem => ({ id: `rest-${n}`, kind: 'rest' })
// Workout row (newest-first lists in tests): W('w2','b') = workout w2 from
// template b.
const W = (id: string, rid: string | null) => ({ id, source_routine_id: rid })

const seq = [R('a'), R('b'), R('c')]
const seqRest = [R('a'), REST(1), R('b'), REST(2), R('c')]

describe('programRoutineIds', () => {
  it('keeps template order and drops rest slots', () => {
    expect(programRoutineIds(seqRest)).toEqual(['a', 'b', 'c'])
  })
})

describe('nextProgramRoutineId', () => {
  it('returns null when the program has no templates', () => {
    expect(nextProgramRoutineId([], [W('w1', 'a')])).toBeNull()
    expect(nextProgramRoutineId([REST(1)], [])).toBeNull()
  })
  it('starts at the first template when nothing has been trained', () => {
    expect(nextProgramRoutineId(seq, [])).toBe('a')
  })
  it('advances past the last trained template', () => {
    expect(nextProgramRoutineId(seq, [W('w1', 'a')])).toBe('b')
  })
  it('wraps around after the last template', () => {
    expect(nextProgramRoutineId(seq, [W('w1', 'c')])).toBe('a')
  })
  it('skips rest days (rest is never returned)', () => {
    expect(nextProgramRoutineId(seqRest, [W('w1', 'a')])).toBe('b')
  })
  it('honors a live pin', () => {
    expect(
      nextProgramRoutineId(seq, [W('w1', 'a')], {
        routineId: 'c',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('c')
  })
  it('honors pinning the routine you just trained (repeat a day)', () => {
    expect(
      nextProgramRoutineId(seq, [W('w1', 'a')], {
        routineId: 'a',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('a')
  })
  it('consumes the pin once any program workout is logged after it', () => {
    // pinned a (repeat) at marker w1, but trained b since → pin dead, next = c
    expect(
      nextProgramRoutineId(seq, [W('w2', 'b'), W('w1', 'a')], {
        routineId: 'a',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('c')
    // pinned c at w1 and then trained it → resume rotation after c
    expect(
      nextProgramRoutineId(seq, [W('w3', 'c'), W('w2', 'b'), W('w1', 'a')], {
        routineId: 'c',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('a')
  })
  it('never resurrects a consumed pin later in the rotation', () => {
    // pinned c at w1, trained c then a — pin must stay dead (old bug: c again)
    expect(
      nextProgramRoutineId(seq, [W('w3', 'a'), W('w2', 'c'), W('w1', 'a')], {
        routineId: 'c',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('b')
  })
  it('supports a pin set before any history, consumed by the first workout', () => {
    const pin = { routineId: 'b', sinceWorkoutId: null }
    expect(nextProgramRoutineId(seq, [], pin)).toBe('b')
    expect(nextProgramRoutineId(seq, [W('w1', 'b')], pin)).toBe('c')
  })
  it('ignores a pin not in the program', () => {
    expect(
      nextProgramRoutineId(seq, [W('w1', 'a')], {
        routineId: 'zzz',
        sinceWorkoutId: 'w1',
      }),
    ).toBe('b')
  })
  it('keeps legacy string pins working (active only while ≠ last done)', () => {
    expect(nextProgramRoutineId(seq, [W('w1', 'a')], 'c')).toBe('c')
    expect(nextProgramRoutineId(seq, [W('w1', 'a')], 'a')).toBe('b')
    expect(nextProgramRoutineId(seq, [W('w1', 'a')], 'zzz')).toBe('b')
  })
})

describe('currentProgramIndex', () => {
  it('is -1 when nothing has been trained', () => {
    expect(currentProgramIndex(seqRest, [])).toBe(-1)
  })
  it('returns the sequence index of the last trained template', () => {
    // 'b' sits at sequence index 2 (after R('a'), REST)
    expect(currentProgramIndex(seqRest, [W('w1', 'b')])).toBe(2)
  })
})

describe('upcomingProgramRoutineIds', () => {
  it('lists the next templates in order, wrapping', () => {
    expect(upcomingProgramRoutineIds(seq, [W('w1', 'a')], null, 3)).toEqual([
      'b',
      'c',
      'a',
    ])
  })
  it('starts from the first template with no history', () => {
    expect(upcomingProgramRoutineIds(seqRest, [], null, 2)).toEqual(['a', 'b'])
  })
})

describe('cycleCounts', () => {
  it('counts total, template, and rest days', () => {
    expect(cycleCounts(seqRest)).toEqual({ length: 5, lifts: 3, rests: 2 })
  })
})

describe('programWorkoutCount', () => {
  it('counts only workouts from in-program templates', () => {
    const w = [
      { source_routine_id: 'a' },
      { source_routine_id: 'x' }, // not in the program
      { source_routine_id: 'b' },
      { source_routine_id: null },
    ]
    expect(programWorkoutCount(['a', 'b', 'c'], w)).toBe(2)
  })
})

describe('deloadActive', () => {
  const ids = ['a', 'b', 'c']
  const done = (n: number) =>
    Array.from({ length: n }, () => ({ source_routine_id: 'a' }))
  it('is inactive with no deload', () => {
    expect(deloadActive(null, ids, done(5), 3)).toBe(false)
  })
  it('is inactive when the program has no training days', () => {
    expect(deloadActive({ startProgramWorkouts: 0 }, ids, done(5), 0)).toBe(false)
  })
  it('stays active within one cycle of the start', () => {
    // started at 2 program workouts, now 4 → 2 of 3 done
    expect(deloadActive({ startProgramWorkouts: 2 }, ids, done(4), 3)).toBe(true)
  })
  it('auto-ends after one cycle of workouts', () => {
    // started at 2, now 5 → 3 of 3 done
    expect(deloadActive({ startProgramWorkouts: 2 }, ids, done(5), 3)).toBe(false)
  })
})
