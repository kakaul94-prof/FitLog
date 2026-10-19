import { describe, expect, it } from 'vitest'
import {
  ensureWarmupStretch,
  isLiftKey,
  isWarmupKey,
  liftTags,
  suggestWarmup,
  tickWarmup,
  tickedDrills,
  untickWarmup,
  warmupEstSec,
  WARMUP_MAX,
  WARMUP_MIN,
} from './warmup'
import { WARMUP_DRILLS } from '@/data/warmupDrills'
import { emptyMobility, mobilityWeek } from './mobility'

const tick = (state = emptyMobility(), drill = 'ankle_rocks', seconds = 60) =>
  tickWarmup(state, { workoutId: 'w1', drill, date: '2026-10-12', seconds, id: `e-${drill}`, stretchId: 'wu' })

describe('keys', () => {
  it('separates warm-up, cardio and lift rows', () => {
    expect(isWarmupKey('warmup:ankle_rocks')).toBe(true)
    expect(isLiftKey('warmup:ankle_rocks')).toBe(false)
    expect(isLiftKey('cardio:run')).toBe(false)
    expect(isLiftKey('back_squat')).toBe(true)
  })
})

describe('liftTags', () => {
  it('maps muscles case-insensitively and flags hinges by name', () => {
    expect(liftTags('Back Squat', 'Legs')).toEqual(['ankle', 'hip'])
    expect(liftTags('Romanian Deadlift', 'back')).toEqual(
      expect.arrayContaining(['scap', 'hamstring', 'hip']),
    )
  })
  it('gives unknown muscles nothing', () => {
    expect(liftTags('Mystery', 'Elbows')).toEqual([])
    expect(liftTags('Mystery', null)).toEqual([])
  })
})

describe('suggestWarmup', () => {
  it('returns nothing when no lift maps', () => {
    expect(suggestWarmup([])).toEqual([])
    expect(suggestWarmup([{ name: 'X', muscle: 'Elbows' }])).toEqual([])
  })
  it('covers a leg day with lower-body drills', () => {
    const picks = suggestWarmup([
      { name: 'Back Squat', muscle: 'Legs' },
      { name: 'Romanian Deadlift', muscle: 'Hamstrings' },
      { name: 'Leg Press', muscle: 'Legs' },
    ])
    expect(picks.length).toBeGreaterThanOrEqual(WARMUP_MIN)
    expect(picks.length).toBeLessThanOrEqual(WARMUP_MAX)
    const tags = new Set(picks.flatMap((k) => WARMUP_DRILLS.find((d) => d.key === k)!.tags))
    for (const t of ['ankle', 'hip', 'hamstring']) expect(tags.has(t as never)).toBe(true)
    expect(tags.has('wrist')).toBe(false)
  })
  it('covers a push day with shoulder work and never repeats a drill', () => {
    const picks = suggestWarmup([
      { name: 'Bench Press', muscle: 'Chest' },
      { name: 'Overhead Press', muscle: 'Shoulders' },
      { name: 'Triceps Pushdown', muscle: 'Triceps' },
    ])
    expect(new Set(picks).size).toBe(picks.length)
    const tags = new Set(picks.flatMap((k) => WARMUP_DRILLS.find((d) => d.key === k)!.tags))
    expect(tags.has('shoulder')).toBe(true)
    expect(tags.has('ankle')).toBe(false)
  })
})

describe('warmupEstSec', () => {
  it('sums known drills and ignores unknown keys', () => {
    expect(warmupEstSec(['ankle_rocks', 'leg_swings', 'nope'])).toBe(120)
  })
})

describe('banking', () => {
  it('creates the Warm-up item once and banks the tick against it', () => {
    const s = tick()
    expect(s.stretches).toHaveLength(1)
    expect(s.stretches[0]).toMatchObject({ id: 'wu', warmup: true })
    expect(s.log[0]).toMatchObject({ stretchId: 'wu', seconds: 60, workoutId: 'w1', drill: 'ankle_rocks' })
    const s2 = tick(s, 'leg_swings')
    expect(s2.stretches).toHaveLength(1)
    expect(tickedDrills(s2, 'w1')).toEqual(new Map([['ankle_rocks', 60], ['leg_swings', 60]]))
  })
  it('reuses an existing Warm-up item', () => {
    const base = ensureWarmupStretch(emptyMobility(), 'old').state
    expect(ensureWarmupStretch(base, 'new').stretchId).toBe('old')
  })
  it('ignores a double tick and untick takes the time back', () => {
    const s = tick(tick())
    expect(s.log).toHaveLength(1)
    const u = untickWarmup(s, 'w1', 'ankle_rocks')
    expect(u.log).toHaveLength(0)
    expect(u.stretches).toHaveLength(1)
  })
  it('counts toward the Mobility week total', () => {
    const wk = mobilityWeek(tick(tick(), 'leg_swings', 30), '2026-10-12')
    expect(wk.bankedSec).toBe(90)
  })
})
