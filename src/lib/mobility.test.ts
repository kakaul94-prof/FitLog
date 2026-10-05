import { describe, expect, it } from 'vitest'
import {
  bankSeconds,
  bankedByStretch,
  clockLabel,
  emptyMobility,
  minLabel,
  mobilityWeek,
  pruneMobilityLog,
  stretchWeekByDay,
} from './mobility'
import type { MobilityState } from './database.types'

// Week of Mon 2026-07-20 … Sun 2026-07-26.
const MON = '2026-07-20'
const WED = '2026-07-22'
const FRI = '2026-07-24'
const SUN = '2026-07-26'

const state = (): MobilityState => ({
  stretches: [
    { id: 'a', name: 'Horse stance', targetMin: 5 },
    { id: 'b', name: 'Dead hangs', targetMin: 5 },
    { id: 'c', name: 'Pancake stretch', targetMin: 10, holdSec: 60 },
  ],
  log: [
    { id: '1', stretchId: 'a', date: MON, seconds: 300 },
    { id: '2', stretchId: 'b', date: MON, seconds: 120 },
    { id: '3', stretchId: 'b', date: WED, seconds: 60 },
    { id: '4', stretchId: 'c', date: FRI, seconds: 480 },
  ],
})

describe('labels', () => {
  it('keeps sub-minute time in seconds so it never reads as 0 min', () => {
    expect(minLabel(40)).toBe('40s')
    expect(minLabel(0)).toBe('0 min')
    expect(minLabel(300)).toBe('5 min')
  })

  it('formats the running clock', () => {
    expect(clockLabel(84)).toBe('1:24')
    expect(clockLabel(9)).toBe('0:09')
    expect(clockLabel(-5)).toBe('0:00')
  })
})

describe('weekly rollup', () => {
  it('sums banked seconds per stretch', () => {
    const by = bankedByStretch(state().log, MON)
    expect(by.get('a')).toBe(300)
    expect(by.get('b')).toBe(180)
  })

  it('ignores time banked in other weeks', () => {
    const s = state()
    s.log.push({ id: '5', stretchId: 'a', date: '2026-07-19', seconds: 600 })
    s.log.push({ id: '6', stretchId: 'a', date: '2026-07-27', seconds: 600 })
    expect(bankedByStretch(s.log, MON).get('a')).toBe(300)
  })

  it('marks a stretch done only once its target is met', () => {
    const w = mobilityWeek(state(), FRI)
    const [a, b, c] = w.rows
    expect(a.done).toBe(true)
    expect(b.done).toBe(false)
    expect(b.progress).toBeCloseTo(0.6)
    expect(c.done).toBe(false)
    expect(w.doneCount).toBe(1)
  })

  it('totals the week and clamps progress', () => {
    const w = mobilityWeek(state(), FRI)
    expect(w.bankedSec).toBe(960)
    expect(w.targetSec).toBe(20 * 60)
    expect(w.progress).toBeCloseTo(0.8)
  })

  it('counts days left inclusive of today', () => {
    expect(mobilityWeek(state(), MON).daysLeft).toBe(7)
    expect(mobilityWeek(state(), FRI).daysLeft).toBe(3)
    expect(mobilityWeek(state(), SUN).daysLeft).toBe(1)
  })

  it('handles an empty list', () => {
    const w = mobilityWeek(emptyMobility(), FRI)
    expect(w.rows).toEqual([])
    expect(w.progress).toBe(0)
  })

  it('survives a null state (nothing set up yet)', () => {
    expect(mobilityWeek(null, FRI).rows).toEqual([])
  })
})

describe('banking time', () => {
  it('appends an entry', () => {
    const next = bankSeconds(state(), 'a', FRI, 90, 'new')
    expect(next.log).toHaveLength(5)
    expect(bankedByStretch(next.log, MON).get('a')).toBe(390)
  })

  it('ignores sub-second and negative amounts', () => {
    const s = state()
    expect(bankSeconds(s, 'a', FRI, 0, 'x').log).toHaveLength(4)
    expect(bankSeconds(s, 'a', FRI, -30, 'x').log).toHaveLength(4)
  })

  it('does not mutate the input', () => {
    const s = state()
    bankSeconds(s, 'a', FRI, 90, 'new')
    expect(s.log).toHaveLength(4)
  })
})

describe('pruning', () => {
  it('drops entries older than the retention window but keeps recent ones', () => {
    const log = [
      { id: 'old', stretchId: 'a', date: '2026-01-05', seconds: 60 },
      { id: 'recent', stretchId: 'a', date: '2026-07-13', seconds: 60 },
      { id: 'now', stretchId: 'a', date: FRI, seconds: 60 },
    ]
    const kept = pruneMobilityLog(log, FRI).map((e) => e.id)
    expect(kept).toContain('now')
    expect(kept).toContain('recent')
    expect(kept).not.toContain('old')
  })
})

describe('per-day breakdown', () => {
  it('groups one stretch by day, oldest first', () => {
    expect(stretchWeekByDay(state().log, 'b', MON)).toEqual([
      { date: MON, seconds: 120 },
      { date: WED, seconds: 60 },
    ])
  })
})
