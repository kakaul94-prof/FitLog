import { describe, expect, it } from 'vitest'
import { EXERCISES } from './exercises'
import { ACTIVITIES } from './activities'
import { EXERCISE_FORM } from './exerciseForm'
import { builtinKeyForName, normalizeExerciseName } from './exerciseAliases'
import {
  REGION_IDS,
  EXERCISE_OVERRIDE,
  TAG_CONTRIB,
  NAME_CONTRIB,
  DEFAULT_GOALS,
  contribForTag,
  resolveGoals,
  heatColor,
  volumeStatus,
  regionForSlug,
  resolveContrib,
} from './bodyMap'

const EX_KEYS = new Set(EXERCISES.map((e) => e.key))
const REGIONS = new Set<string>(REGION_IDS)
// Cue-only keys that live in EXERCISE_FORM but are deliberately NOT pickable
// exercises (see exerciseForm.ts / exerciseAliases.ts).
const FORM_ONLY = new Set(['incline_db_press', 'cable_crunch'])

describe('exercises library', () => {
  it('has unique keys', () => {
    const keys = EXERCISES.map((e) => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has a non-empty name and muscle tag on every entry', () => {
    for (const e of EXERCISES) {
      expect(e.name.trim(), e.key).not.toBe('')
      expect(e.muscle.trim(), e.key).not.toBe('')
    }
  })

  // BUILTIN_BY_NAME (exerciseAliases) keys built-ins by normalized name, so a
  // collision would silently shadow a lift.
  it('has unique normalized names', () => {
    const norms = EXERCISES.map((e) => normalizeExerciseName(e.name))
    expect(new Set(norms).size).toBe(norms.length)
  })
})

describe('activities library', () => {
  it('has unique keys', () => {
    const keys = ACTIVITIES.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has a positive MET and a name on every entry', () => {
    for (const a of ACTIVITIES) {
      expect(a.met, a.key).toBeGreaterThan(0)
      expect(a.name.trim(), a.key).not.toBe('')
    }
  })
})

describe('exercise form cues', () => {
  it('keys are real exercises or known cue-only keys', () => {
    for (const key of Object.keys(EXERCISE_FORM)) {
      expect(EX_KEYS.has(key) || FORM_ONLY.has(key), key).toBe(true)
    }
  })

  it('every entry carries at least one cue', () => {
    for (const [key, form] of Object.entries(EXERCISE_FORM)) {
      expect(form.cues.length, key).toBeGreaterThan(0)
    }
  })
})

describe('exercise name aliases', () => {
  it('resolves every built-in name back to its own key', () => {
    for (const e of EXERCISES) {
      expect(builtinKeyForName(e.name), e.name).toBe(e.key)
    }
  })

  it('returns undefined for missing or unknown names', () => {
    expect(builtinKeyForName(undefined)).toBeUndefined()
    expect(builtinKeyForName('a totally made up lift')).toBeUndefined()
  })

  it('maps known import aliases to a built-in key', () => {
    expect(builtinKeyForName('Squat')).toBe('back_squat')
    expect(builtinKeyForName('Pull Ups')).toBe('pull_up')
  })

  it('maps a form-only alias to a cue-only key (never a stored exercise)', () => {
    const key = builtinKeyForName('Inclined Dumbbell Press')
    expect(key).toBe('incline_db_press')
    expect(EXERCISE_FORM[key!]).toBeDefined()
    expect(EX_KEYS.has(key!)).toBe(false)
  })

  it('normalizes case, parentheticals, and punctuation', () => {
    expect(normalizeExerciseName('Bench Press (Chest)')).toBe('bench press')
    expect(normalizeExerciseName('One-Arm  Dumbbell/Row')).toBe(
      'one arm dumbbell row',
    )
  })
})

describe('muscle-volume mapping', () => {
  it('keys every per-exercise override to a real built-in', () => {
    for (const key of Object.keys(EXERCISE_OVERRIDE)) {
      expect(EX_KEYS.has(key), key).toBe(true)
    }
  })

  it('uses only valid region ids with positive weights', () => {
    const maps = { TAG_CONTRIB, EXERCISE_OVERRIDE, NAME_CONTRIB }
    for (const [mapName, map] of Object.entries(maps)) {
      for (const [entry, contrib] of Object.entries(map)) {
        for (const [region, weight] of Object.entries(contrib)) {
          expect(REGIONS.has(region), `${mapName}.${entry}.${region}`).toBe(true)
          expect(weight, `${mapName}.${entry}.${region}`).toBeGreaterThan(0)
        }
      }
    }
  })

  // Resolution order mirrors useMuscleVolume: override -> name -> tag. Every
  // built-in must land somewhere or it stays neutral on the heatmap.
  const resolveBuiltin = (e: (typeof EXERCISES)[number]) =>
    EXERCISE_OVERRIDE[e.key] ??
    NAME_CONTRIB[normalizeExerciseName(e.name)] ??
    contribForTag(e.muscle)

  it('resolves a contribution for every built-in lift', () => {
    for (const e of EXERCISES) {
      if (e.kind === 'mobility') continue
      expect(resolveBuiltin(e), `${e.key} (${e.muscle})`).toBeTruthy()
    }
  })

  // Stretches are held, not trained — counting them as sets would inflate the
  // heatmap, so resolveContrib drops them even when their tag would otherwise
  // match (Pigeon Pose → Glutes).
  it('leaves mobility work off the volume heatmap', () => {
    const mobility = EXERCISES.filter((e) => e.kind === 'mobility')
    expect(mobility.length).toBeGreaterThan(0)
    for (const e of mobility)
      expect(
        resolveContrib(e.key, e.name, new Map()),
        `${e.key} (${e.muscle})`,
      ).toBeUndefined()
  })

  it('resolves muscle tags tolerant of synonyms and casing', () => {
    expect(contribForTag('Tricep')).toEqual(TAG_CONTRIB.Triceps)
    expect(contribForTag('abs')).toEqual(TAG_CONTRIB.Core)
    expect(contribForTag(null)).toBeUndefined()
    expect(contribForTag('made up muscle')).toBeUndefined()
  })

  it('maps asset slugs to regions, null for the unmapped', () => {
    expect(regionForSlug('front', 'chest')).toBe('chest')
    expect(regionForSlug('back', 'gluteal')).toBe('glutes')
    expect(regionForSlug('front', 'not-a-slug')).toBeNull()
  })
})

describe('volume goals + heat scale', () => {
  it('has a default goal for every region', () => {
    for (const r of REGION_IDS) {
      expect(DEFAULT_GOALS[r], r).toBeTypeOf('number')
    }
  })

  it('merges sparse stored goals over the defaults', () => {
    expect(resolveGoals(null)).toEqual(DEFAULT_GOALS)
    const merged = resolveGoals({ chest: 20, bogus: 99 })
    expect(merged.chest).toBe(20)
    expect(merged.biceps).toBe(DEFAULT_GOALS.biceps)
    expect((merged as Record<string, number>).bogus).toBeUndefined()
    expect(resolveGoals({ chest: -5 }).chest).toBe(DEFAULT_GOALS.chest)
  })

  it('returns neutral heat for no sets or no goal', () => {
    expect(heatColor(0, 10)).toBeNull()
    expect(heatColor(5, 0)).toBeNull()
    expect(typeof heatColor(5, 10)).toBe('string')
    expect(heatColor(2, 10)).not.toBe(heatColor(13, 10))
  })

  it('describes volume status against the goal', () => {
    expect(volumeStatus(0, 10)).toBe('none logged')
    expect(volumeStatus(5, 0)).toBe('no goal set')
    expect(volumeStatus(13, 10)).toBe('over goal')
  })
})
