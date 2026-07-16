import { describe, it, expect } from 'vitest'
import {
  haversineMeters,
  metersToMiles,
  newTrack,
  addFix,
  movingMph,
  paceSecPerMile,
  METERS_PER_MILE,
  type GeoFix,
} from './geo'

const f = (lat: number, lng: number, accuracy: number, t: number): GeoFix => ({
  lat,
  lng,
  accuracy,
  t,
})

describe('haversineMeters', () => {
  it('measures ~100 m for 0.0009° of latitude', () => {
    expect(haversineMeters(f(0, 0, 5, 0), f(0.0009, 0, 5, 0))).toBeCloseTo(100, 0)
  })
  it('is zero for identical points', () => {
    expect(haversineMeters(f(40, -75, 5, 0), f(40, -75, 5, 0))).toBe(0)
  })
})

describe('metersToMiles', () => {
  it('inverts a mile', () => {
    expect(metersToMiles(METERS_PER_MILE)).toBeCloseTo(1, 6)
  })
})

describe('addFix', () => {
  it('sets the anchor on the first good fix, no distance yet', () => {
    const s = addFix(newTrack(), f(0, 0, 10, 0))
    expect(s.meters).toBe(0)
    expect(s.last).not.toBeNull()
  })

  it('rejects low-accuracy fixes (unchanged state)', () => {
    const s0 = addFix(newTrack(), f(0, 0, 10, 0))
    const s1 = addFix(s0, f(0.0009, 0, 50, 5000)) // accuracy 50 > 25
    expect(s1).toBe(s0)
  })

  it('accumulates a real move and counts it as moving time', () => {
    let s = addFix(newTrack(), f(0, 0, 10, 0))
    s = addFix(s, f(0.0009, 0, 10, 50000)) // ~100 m over 50 s → 2 m/s
    expect(s.meters).toBeCloseTo(100, 0)
    expect(s.movingMs).toBe(50000)
  })

  it('ignores sub-step jitter', () => {
    const s0 = addFix(newTrack(), f(0, 0, 10, 0))
    const s1 = addFix(s0, f(0.00002, 0, 10, 2000)) // ~2.2 m < 4 m minStep
    expect(s1).toBe(s0)
  })

  it('rejects teleport jumps', () => {
    const s0 = addFix(newTrack(), f(0, 0, 10, 0))
    const s1 = addFix(s0, f(1, 0, 10, 1000)) // ~111 km in 1 s
    expect(s1).toBe(s0)
  })

  it('adds distance but no moving time when barely creeping', () => {
    let s = addFix(newTrack(), f(0, 0, 10, 0))
    s = addFix(s, f(0.00009, 0, 10, 60000)) // ~10 m over 60 s → 0.17 m/s < 0.5
    expect(s.meters).toBeCloseTo(10, 0)
    expect(s.movingMs).toBe(0)
  })
})

describe('movingMph / paceSecPerMile', () => {
  it('computes mph from metres + moving ms', () => {
    expect(movingMph(METERS_PER_MILE, 900000)).toBeCloseTo(4, 5) // 1 mi / 15 min
  })
  it('computes pace as seconds per mile', () => {
    expect(paceSecPerMile(METERS_PER_MILE, 900000)).toBeCloseTo(900, 5)
  })
  it('is zero when not moving', () => {
    expect(movingMph(100, 0)).toBe(0)
    expect(paceSecPerMile(100, 0)).toBe(0)
  })
})
