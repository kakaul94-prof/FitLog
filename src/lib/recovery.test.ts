import { describe, expect, it } from 'vitest'
import {
  agoLabel,
  answeredToday,
  isRecent,
  jointsLoaded,
  lastActivity,
  musclesWorked,
  recoveryPingAt,
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
  it('fires 24 h after the workout ends, across a month end', () => {
    const d = recoveryPingAt(new Date(2026, 9, 31, 18, 30))
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([10, 1, 18, 30])
  })
  it('keeps the question out of 21:00–9:00 quiet hours', () => {
    const hm = (d: Date) => [d.getDate(), d.getHours(), d.getMinutes()]
    expect(hm(recoveryPingAt(new Date(2026, 9, 26, 7, 0)))).toEqual([27, 9, 0])
    expect(hm(recoveryPingAt(new Date(2026, 9, 26, 22, 30)))).toEqual([27, 21, 0])
    expect(hm(recoveryPingAt(new Date(2026, 9, 26, 21, 0)))).toEqual([27, 21, 0])
    expect(hm(recoveryPingAt(new Date(2026, 9, 26, 9, 0)))).toEqual([27, 9, 0])
  })
  it('takes the end from the latest Done tap or logged set', () => {
    const t = lastActivity([
      '2026-10-26T18:05:00.123456+00:00',
      null,
      '2026-10-26T18:40:00.000Z',
      '2026-10-26T18:20:00+00:00',
    ])
    expect(t?.toISOString()).toBe('2026-10-26T18:40:00.000Z')
    expect(lastActivity([null, undefined])).toBeNull()
  })
  it('knows the notification was answered today (local date)', () => {
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
    expect(recoverySummary(c2.after)).toBe('a day later: knee achy; before next workout: all fine')
  })
  it('labels sides and sharp pain', () => {
    const a = answer({ joints: { shoulder: { feel: 'sharp', side: 'left' } } })
    expect(recoverySummary({ pre: a })).toBe('before next workout: left shoulder sharp pain')
  })
})
