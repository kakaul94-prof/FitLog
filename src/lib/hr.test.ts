import { describe, expect, it } from 'vitest'
import {
  addHrSample,
  dominantZone,
  downsampleBpm,
  hasHrCurve,
  hrCalories,
  newHrTrack,
  parseHrMeasurement,
  summarizeHr,
} from './hr'

const dv = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer)

describe('parseHrMeasurement', () => {
  it('reads an 8-bit heart rate', () => {
    expect(parseHrMeasurement(dv([0x00, 142]))?.bpm).toBe(142)
  })

  it('reads a 16-bit heart rate (flag bit 0)', () => {
    // 0x0110 = 272 bpm, little-endian
    expect(parseHrMeasurement(dv([0x01, 0x10, 0x01]))?.bpm).toBe(272)
  })

  it('reports sensor contact only when the strap says so', () => {
    expect(parseHrMeasurement(dv([0x00, 90]))?.contact).toBeNull()
    expect(parseHrMeasurement(dv([0x06, 90]))?.contact).toBe(true)
    expect(parseHrMeasurement(dv([0x04, 90]))?.contact).toBe(false)
  })

  it('skips the energy field to find the R-R intervals', () => {
    // flags 0x18 = energy present + R-R present; energy 0x0064, R-R 1024 = 1000ms
    const m = parseHrMeasurement(dv([0x18, 100, 0x64, 0x00, 0x00, 0x04]))
    expect(m?.bpm).toBe(100)
    expect(m?.rr).toEqual([1000])
  })

  it('returns null on a truncated packet', () => {
    expect(parseHrMeasurement(dv([0x00]))).toBeNull()
    expect(parseHrMeasurement(dv([0x01, 0x10]))).toBeNull()
  })
})

describe('addHrSample', () => {
  it('carries the last reading across a short dropout', () => {
    const t = newHrTrack()
    addHrSample(t, 120, 0)
    addHrSample(t, 130, 4)
    expect(t.bpm).toEqual([120, 120, 120, 120, 130])
  })

  it('leaves a long dropout empty instead of inventing beats', () => {
    const t = newHrTrack()
    addHrSample(t, 120, 0)
    addHrSample(t, 130, 40)
    // Held forward from the last real reading, then given up on.
    expect(t.bpm[15]).toBe(120)
    expect(t.bpm[16]).toBe(0)
    expect(t.bpm[39]).toBe(0)
    expect(t.bpm[40]).toBe(130)
  })

  it('ignores readings that go backwards (a pause rewinds nothing)', () => {
    const t = newHrTrack()
    addHrSample(t, 120, 10)
    addHrSample(t, 200, 3)
    expect(t.bpm[10]).toBe(120)
    expect(t.lastIdx).toBe(10)
  })
})

describe('summarizeHr', () => {
  it('averages only the seconds that carry a reading', () => {
    const s = summarizeHr([100, 0, 0, 140], 200)
    expect(s.avg).toBe(120)
    expect(s.max).toBe(140)
    expect(s.min).toBe(100)
    expect(s.seconds).toBe(2)
  })

  it('banks each second into its zone', () => {
    // max 200 → z1 100–119, z2 120–139, z3 140–159, z4 160–179, z5 180+
    const s = summarizeHr([110, 110, 130, 150, 150, 150, 185, 40], 200)
    expect(s.zoneSeconds).toEqual([2, 1, 3, 0, 1])
  })

  it('still reports avg and max with no max HR to zone against', () => {
    const s = summarizeHr([100, 140], null)
    expect(s.avg).toBe(120)
    expect(s.zoneSeconds).toEqual([0, 0, 0, 0, 0])
  })

  it('is empty for a session with no readings', () => {
    expect(summarizeHr([], 200).avg).toBeNull()
    expect(summarizeHr([0, 0], 200).max).toBeNull()
  })
})

describe('dominantZone', () => {
  it('picks the zone with the most seconds', () => {
    expect(dominantZone([10, 300, 60, 0, 0])).toBe(2)
  })
  it('is null when nothing was banked', () => {
    expect(dominantZone([0, 0, 0, 0, 0])).toBeNull()
  })
})

describe('downsampleBpm', () => {
  it('averages each bucket', () => {
    expect(downsampleBpm([100, 110, 120, 130, 140, 150], 3)).toEqual([110, 140])
  })
  it('ignores gaps inside a bucket, and zeroes an all-gap bucket', () => {
    expect(downsampleBpm([100, 0, 0, 0, 0, 0], 3)).toEqual([100, 0])
  })
})

describe('hasHrCurve', () => {
  it('is false for missing or all-empty samples', () => {
    expect(hasHrCurve(null)).toBe(false)
    expect(hasHrCurve({ start: '', interval_s: 5, bpm: [0, 0] })).toBe(false)
    expect(hasHrCurve({ start: '', interval_s: 5, bpm: [0, 120] })).toBe(true)
  })
})

describe('hrCalories', () => {
  it('estimates a burn from average HR (Keytel)', () => {
    // 40y male, 180 lb (81.6 kg), 30 min at 140 bpm
    expect(hrCalories(140, 30, 180, 40, 'male')).toBe(412)
  })

  it('burns less for the same effort on the female equation', () => {
    const m = hrCalories(140, 30, 180, 40, 'male')!
    const f = hrCalories(140, 30, 180, 40, 'female')!
    expect(f).toBeLessThan(m)
    expect(f).toBeGreaterThan(0)
  })

  it('clamps the resting-HR negative to zero', () => {
    expect(hrCalories(45, 30, 180, 40, 'male')).toBe(0)
  })

  it('is null when an input is missing', () => {
    expect(hrCalories(140, 30, 180, null, 'male')).toBeNull()
    expect(hrCalories(140, 30, null, 40, 'male')).toBeNull()
    expect(hrCalories(null, 30, 180, 40, 'male')).toBeNull()
  })
})
