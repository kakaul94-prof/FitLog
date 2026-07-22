import { describe, expect, it } from 'vitest'
import { nextFireAt, parseTime } from './reminders'

describe('parseTime', () => {
  it('parses HH:MM', () => {
    expect(parseTime('08:00')).toEqual({ hour: 8, minute: 0 })
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseTime('7:05')).toEqual({ hour: 7, minute: 5 })
  })

  it('clamps out-of-range values', () => {
    expect(parseTime('25:99')).toEqual({ hour: 23, minute: 59 })
  })

  it('falls back to 00:00 on junk', () => {
    expect(parseTime('')).toEqual({ hour: 0, minute: 0 })
    expect(parseTime('later')).toEqual({ hour: 0, minute: 0 })
  })
})

describe('nextFireAt', () => {
  const at = (iso: string) => new Date(iso)

  it('fires today when the time is still ahead', () => {
    const d = nextFireAt('20:00', at('2026-07-22T18:00:00'), false)
    expect(d).toEqual(at('2026-07-22T20:00:00'))
  })

  it('rolls to tomorrow once the time has passed', () => {
    const d = nextFireAt('20:00', at('2026-07-22T21:30:00'), false)
    expect(d).toEqual(at('2026-07-23T20:00:00'))
  })

  it('rolls to tomorrow when now is exactly the fire time', () => {
    const d = nextFireAt('20:00', at('2026-07-22T20:00:00'), false)
    expect(d).toEqual(at('2026-07-23T20:00:00'))
  })

  it('skipToday forces tomorrow even when the time is ahead', () => {
    const d = nextFireAt('20:00', at('2026-07-22T18:00:00'), true)
    expect(d).toEqual(at('2026-07-23T20:00:00'))
  })

  it('crosses month boundaries', () => {
    const d = nextFireAt('20:00', at('2026-07-31T22:00:00'), false)
    expect(d).toEqual(at('2026-08-01T20:00:00'))
  })
})
