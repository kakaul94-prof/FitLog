import { describe, expect, it } from 'vitest'
import { EXERCISES } from '@/data/exercises'
import { JOINT_STRESS, SWAPS } from '@/data/jointStress'
import { PAIN_SITES } from './rehab'
import { checkinSummary, planSwaps, resolveLiftKey, sitesWorked } from './checkin'
import type { CheckinFlag } from './database.types'

const lift = (key: string, name = key) => ({ id: key, key, name })
const sore = (site: string): CheckinFlag => ({ site, side: null, level: 'sore' })
const sharp = (site: string): CheckinFlag => ({ site, side: null, level: 'sharp' })

describe('joint-stress data', () => {
  const keys = new Set(EXERCISES.map((e) => e.key))
  it('only references real lifts and real sites', () => {
    for (const [k, sites] of Object.entries(JOINT_STRESS)) {
      expect(keys.has(k), k).toBe(true)
      for (const s of sites) expect(PAIN_SITES.includes(s), `${k}:${s}`).toBe(true)
    }
    for (const [k, alts] of Object.entries(SWAPS)) {
      expect(JOINT_STRESS[k], k).toBeDefined()
      for (const a of alts) expect(JOINT_STRESS[a], `${k}→${a}`).toBeDefined()
    }
  })
})

describe('resolveLiftKey', () => {
  it('keeps built-in keys and resolves imported names, plurals included', () => {
    expect(resolveLiftKey('back_squat', 'Back Squat')).toBe('back_squat')
    expect(resolveLiftKey('custom:1', 'Squat')).toBe('back_squat')
    expect(resolveLiftKey('custom:2', 'Romanian Deadlifts')).toBe('romanian_deadlift')
    expect(resolveLiftKey('custom:3', 'Zercher carry')).toBeUndefined()
  })
})

describe('planSwaps', () => {
  it('swaps squat → belt squat and RDL → leg curl for a sore low back', () => {
    const p = planSwaps(
      [lift('back_squat'), lift('romanian_deadlift'), lift('calf_raise')],
      [sore('low back')],
    )
    expect(p.suggestions.map((s) => [s.lift.key, s.action, s.options[0]?.key])).toEqual([
      ['back_squat', 'swap', 'belt_squat'],
      ['romanian_deadlift', 'swap', 'leg_curl'],
    ])
  })

  it('suggests skipping when the site is sharp', () => {
    const [s] = planSwaps([lift('back_squat')], [sharp('low back')]).suggestions
    expect(s.level).toBe('sharp')
    expect(s.action).toBe('skip')
    expect(s.options[0].key).toBe('belt_squat') // still offered
  })

  it('never suggests an alternative that loads another sore site', () => {
    const [s] = planSwaps([lift('back_squat')], [sore('low back'), sore('knee')]).suggestions
    expect(s.options.every((o) => !JOINT_STRESS[o.key].includes('knee'))).toBe(true)
    expect(s.action).toBe('keep') // every quad option loads the knee
  })

  it('avoids doubling a lift already planned or already claimed', () => {
    const p = planSwaps(
      [lift('back_squat'), lift('front_squat'), lift('belt_squat')],
      [sore('low back')],
    )
    const picks = p.suggestions.map((s) => s.options[0].key)
    expect(picks).toEqual(['leg_press', 'goblet_squat'])
  })

  it('hands lifts with no rule to the trainer, and ignores "other"', () => {
    expect(planSwaps([lift('custom:x', 'Zercher carry')], [sore('knee')]).unknown).toHaveLength(1)
    expect(planSwaps([lift('back_squat')], [sore('other')]).suggestions).toHaveLength(0)
  })
})

describe('summaries', () => {
  it('lists what was worked and what changed', () => {
    expect(sitesWorked([lift('leg_curl'), lift('hip_thrust')]).sort()).toEqual(['hip', 'knee'])
    expect(
      checkinSummary({
        flags: [{ site: 'knee', side: 'left', level: 'sore' }],
        swaps: [{ fromKey: 'a', fromName: 'Back Squat', toKey: 'b', toName: 'Belt Squat' }],
        skipped: ['Lunge'],
      }),
    ).toBe('left knee sore · swapped Back Squat → Belt Squat · skipped Lunge')
  })
})
