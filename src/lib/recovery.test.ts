import { describe, expect, it } from 'vitest'
import {
  agoLabel,
  answeredToday,
  isRecent,
  jointsLoaded,
  musclesWorked,
  nextMorning9,
  recoverySummary,
  sorenessHeadsUp,
  withRecovery,
} from './recovery'
import type { RecoveryAnswer } from './database.types'

const none = new Map<string, string | null>()
const L = (key: string, name = key) => ({ key, name })
const answer = (p: Partial<RecoveryAnswer>): RecoveryAnswer => ({
  at: '2026-10-11T09:00:00Z',
  muscles: {},
  joints: {},
  ...p,
})

describe('what a workout worked', () => {
  it('keeps only main (weight-1) muscles, in heatmap order', () => {
    // RDL: hams 1, glutes 1, erector 0.5 → erector is not a main muscle.
    expect(musclesWorked([L('romanian_deadlift')], none)).toEqual(['hams', 'glutes'])
  })
  it('maps custom/imported lifts through their name', () => {
    expect(jointsLoaded([L('custom:1', 'Squat')])).toEqual(['shoulder', 'low back', 'hip', 'knee'])
  })
})

describe('timing', () => {
  it('treats under 3 days as recent', () => {
    expect(isRecent('2026-10-09', '2026-10-11')).toBe(true)
    expect(isRecent('2026-10-08', '2026-10-11')).toBe(false)
    expect(agoLabel('2026-10-10', '2026-10-11')).toBe('yesterday')
  })
  it('fires at 9:00 the next day, across a month end', () => {
    const d = nextMorning9('2026-10-31')
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([10, 1, 9])
  })
  it('knows a 9:00 answer was given today (local date)', () => {
    const at = (day: number, h: number) => new Date(2026, 9, day, h, 4).toISOString()
    expect(answeredToday(answer({ at: at(19, 9) }), '2026-10-19')).toBe(true)
    expect(answeredToday(answer({ at: at(19, 23) }), '2026-10-19')).toBe(true)
    expect(answeredToday(answer({ at: at(18, 9) }), '2026-10-19')).toBe(false)
    expect(answeredToday(undefined, '2026-10-19')).toBe(false)
  })
})

describe('answers', () => {
  it('flags today’s lifts that work a very sore muscle', () => {
    const a = answer({ muscles: { quads: { feel: 'very_sore' }, hams: { feel: 'sore' } } })
    expect(sorenessHeadsUp([L('leg_press'), L('leg_curl')], a, none)).toEqual([
      { lift: 'leg_press', regions: ['quads'] },
    ])
  })
  it('keeps both slots and the workout’s own check-in', () => {
    const morning = answer({ joints: { knee: { feel: 'achy' } } })
    const c1 = withRecovery(null, 'morning', morning)
    const c2 = withRecovery({ ...c1, skipped: ['Lunge'] }, 'pre', answer({}))
    expect(c2.after?.morning).toBe(morning)
    expect(c2.skipped).toEqual(['Lunge'])
    expect(recoverySummary(c2.after)).toBe('next morning: knee achy; before next workout: all fine')
  })
  it('labels sides and sharp pain', () => {
    const a = answer({ joints: { shoulder: { feel: 'sharp', side: 'left' } } })
    expect(recoverySummary({ pre: a })).toBe('before next workout: left shoulder sharp pain')
  })
})
