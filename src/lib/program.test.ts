import { describe, expect, it } from 'vitest'
import {
  cycleCounts,
  currentProgramIndex,
  nextProgramRoutineId,
  programRoutineIds,
  upcomingProgramRoutineIds,
} from './program'
import type { ProgramItem } from './database.types'

const R = (routineId: string): ProgramItem => ({
  id: `i-${routineId}`,
  kind: 'routine',
  routineId,
})
const REST = (n = 0): ProgramItem => ({ id: `rest-${n}`, kind: 'rest' })

const seq = [R('a'), R('b'), R('c')]
const seqRest = [R('a'), REST(1), R('b'), REST(2), R('c')]

describe('programRoutineIds', () => {
  it('keeps template order and drops rest slots', () => {
    expect(programRoutineIds(seqRest)).toEqual(['a', 'b', 'c'])
  })
})

describe('nextProgramRoutineId', () => {
  it('returns null when the program has no templates', () => {
    expect(nextProgramRoutineId([], [{ source_routine_id: 'a' }])).toBeNull()
    expect(nextProgramRoutineId([REST(1)], [])).toBeNull()
  })
  it('starts at the first template when nothing has been trained', () => {
    expect(nextProgramRoutineId(seq, [])).toBe('a')
  })
  it('advances past the last trained template', () => {
    expect(nextProgramRoutineId(seq, [{ source_routine_id: 'a' }])).toBe('b')
  })
  it('wraps around after the last template', () => {
    expect(nextProgramRoutineId(seq, [{ source_routine_id: 'c' }])).toBe('a')
  })
  it('skips rest days (rest is never returned)', () => {
    expect(nextProgramRoutineId(seqRest, [{ source_routine_id: 'a' }])).toBe('b')
  })
  it('honors a fresh next override', () => {
    expect(
      nextProgramRoutineId(seq, [{ source_routine_id: 'a' }], 'c'),
    ).toBe('c')
  })
  it('ignores the override once it has been trained (consumed)', () => {
    expect(
      nextProgramRoutineId(seq, [{ source_routine_id: 'a' }], 'a'),
    ).toBe('b')
  })
  it('ignores an override not in the program', () => {
    expect(
      nextProgramRoutineId(seq, [{ source_routine_id: 'a' }], 'zzz'),
    ).toBe('b')
  })
})

describe('currentProgramIndex', () => {
  it('is -1 when nothing has been trained', () => {
    expect(currentProgramIndex(seqRest, [])).toBe(-1)
  })
  it('returns the sequence index of the last trained template', () => {
    // 'b' sits at sequence index 2 (after R('a'), REST)
    expect(currentProgramIndex(seqRest, [{ source_routine_id: 'b' }])).toBe(2)
  })
})

describe('upcomingProgramRoutineIds', () => {
  it('lists the next templates in order, wrapping', () => {
    expect(
      upcomingProgramRoutineIds(seq, [{ source_routine_id: 'a' }], null, 3),
    ).toEqual(['b', 'c', 'a'])
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
