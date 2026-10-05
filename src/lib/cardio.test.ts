import { describe, it, expect } from 'vitest'
import {
  CARDIO_PREFIX,
  isCardioKey,
  cardioActivityKey,
  isRecorderActivity,
  findCardioActivity,
  fmtClock,
  intervalsLabel,
  paceMinPerMi,
  paceLabel,
  cardioTargetChips,
  entryMatchesCardio,
  weekStartISO,
  sumCardioMinutes,
} from './cardio'
import type { CustomActivity } from './database.types'

describe('cardio keys', () => {
  it('round-trips the prefix', () => {
    expect(isCardioKey(`${CARDIO_PREFIX}running`)).toBe(true)
    expect(isCardioKey('bench_press')).toBe(false)
    expect(isCardioKey('custom:abc')).toBe(false)
    expect(cardioActivityKey('cardio:stair_climber')).toBe('stair_climber')
  })

  it('flags GPS-recorder activities', () => {
    expect(isRecorderActivity('running')).toBe(true)
    expect(isRecorderActivity('walking')).toBe(true)
    expect(isRecorderActivity('walking_treadmill')).toBe(false)
  })
})

describe('findCardioActivity', () => {
  const custom: CustomActivity[] = [
    {
      id: 'abc',
      user_id: 'u',
      name: 'Sled push',
      met: 8,
      distance_based: false,
      created_at: '',
    },
  ]
  it('resolves recorder, built-in, and custom activities', () => {
    expect(findCardioActivity('running')?.recorder).toBe(true)
    expect(findCardioActivity('stair_climber')?.met).toBe(9)
    expect(findCardioActivity('custom:abc', custom)?.name).toBe('Sled push')
  })
  it('returns null for a missing key', () => {
    expect(findCardioActivity('custom:gone', custom)).toBeNull()
  })
})

describe('labels', () => {
  it('formats clock strings', () => {
    expect(fmtClock(90)).toBe('1:30')
    expect(fmtClock(45)).toBe('0:45')
    expect(fmtClock(600)).toBe('10:00')
  })

  it('formats intervals', () => {
    expect(intervalsLabel({ rounds: 6, workSec: 60, restSec: 120 })).toBe(
      '6 × 1:00 / 2:00',
    )
  })

  it('computes and formats pace', () => {
    expect(paceMinPerMi(30, 3)).toBe(10)
    expect(paceMinPerMi(30, null)).toBeNull()
    expect(paceMinPerMi(null, 3)).toBeNull()
    expect(paceLabel(10.5)).toBe('10:30 /mi')
  })

  it('builds prescription chips (duration, distance, pace, zone, intervals)', () => {
    expect(
      cardioTargetChips({
        target_duration_min: 20,
        target_distance_mi: null,
        target_zone: 2,
        intervals: null,
      }),
    ).toEqual(['20 min', 'Zone 2'])
    expect(
      cardioTargetChips({
        target_duration_min: 20,
        target_distance_mi: 2,
        target_zone: null,
        intervals: null,
      }),
    ).toEqual(['20 min', '2 mi', '10:00 /mi'])
    expect(
      cardioTargetChips({
        target_duration_min: null,
        target_distance_mi: null,
        target_zone: null,
        intervals: { rounds: 4, workSec: 240, restSec: 180 },
      }),
    ).toEqual(['4 × 4:00 / 3:00'])
    expect(
      cardioTargetChips({
        target_duration_min: null,
        target_distance_mi: null,
        target_zone: null,
        intervals: null,
      }),
    ).toEqual([])
  })
})

describe('completion matching', () => {
  it('matches names case- and whitespace-insensitively', () => {
    expect(entryMatchesCardio('Incline walk', 'incline walk ')).toBe(true)
    expect(entryMatchesCardio('Running', 'Rowing machine (moderate)')).toBe(
      false,
    )
  })
})

describe('weekly window', () => {
  it('finds Monday of the current week', () => {
    expect(weekStartISO('2026-07-24')).toBe('2026-07-20') // Fri → Mon
    expect(weekStartISO('2026-07-20')).toBe('2026-07-20') // Mon → itself
    expect(weekStartISO('2026-07-26')).toBe('2026-07-20') // Sun → prior Mon
  })

  it('sums durations, ignoring nulls', () => {
    expect(
      sumCardioMinutes([
        { duration_min: 30 },
        { duration_min: null },
        { duration_min: 25.4 },
      ]),
    ).toBe(55)
  })
})
