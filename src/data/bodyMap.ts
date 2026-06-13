// Logic layer for the muscle-volume heatmap. Three decoupled layers keep the
// map extensible (see EnhancementsPlanning.txt):
//   1. exercise muscle tags (source, coarse) — src/data/exercises.ts + custom_exercises
//   2. SVG geometry (vendored) — src/data/bodyGeometry.ts
//   3. mapping (this file): tag/exercise -> our regions, and asset slug -> region
import { EXERCISES } from '@/data/exercises'

// Our logical muscle regions — the resolution the exercise data supports today.
// To add finer detail later, split a region here + in the slug/tag maps below.
export type RegionId =
  | 'chest'
  | 'shoulders'
  | 'rear_delts'
  | 'biceps'
  | 'triceps'
  | 'back'
  | 'abs'
  | 'quads'
  | 'hams'
  | 'glutes'
  | 'calves'

export const REGION_IDS: RegionId[] = [
  'chest',
  'shoulders',
  'rear_delts',
  'biceps',
  'triceps',
  'back',
  'abs',
  'quads',
  'hams',
  'glutes',
  'calves',
]

export const REGION_LABEL: Record<RegionId, string> = {
  chest: 'Chest',
  shoulders: 'Shoulders',
  rear_delts: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  back: 'Back / lats',
  abs: 'Core',
  quads: 'Quads',
  hams: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
}

// Vendored asset slug -> our region, per view. The asset uses one "deltoids"
// slug — front view = shoulders, back view = rear delts. Any slug not listed
// (forearm, adductors, neck, head, hands, feet…) renders neutral, which makes
// the figure read like an anatomy chart with only trained muscles lit.
const FRONT_SLUG_REGION: Record<string, RegionId> = {
  chest: 'chest',
  deltoids: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  abs: 'abs',
  obliques: 'abs',
  quadriceps: 'quads',
  trapezius: 'back',
  calves: 'calves',
}
const BACK_SLUG_REGION: Record<string, RegionId> = {
  deltoids: 'rear_delts',
  triceps: 'triceps',
  'upper-back': 'back',
  'lower-back': 'back',
  trapezius: 'back',
  gluteal: 'glutes',
  hamstring: 'hams',
  calves: 'calves',
}

export function regionForSlug(side: 'front' | 'back', slug: string): RegionId | null {
  return (side === 'front' ? FRONT_SLUG_REGION : BACK_SLUG_REGION)[slug] ?? null
}

// Coarse exercise muscle tag -> region weights. Fractional: primary 1.0,
// secondaries 0.5 (the data stores only one tag per exercise, so secondary
// involvement is authored here). Splitting a region later = spread its weight.
export const TAG_CONTRIB: Record<string, Partial<Record<RegionId, number>>> = {
  Chest: { chest: 1, triceps: 0.5, shoulders: 0.5 },
  Back: { back: 1, biceps: 0.5, rear_delts: 0.5 },
  'Rear Delts': { rear_delts: 1 },
  Shoulders: { shoulders: 1, triceps: 0.5 },
  Biceps: { biceps: 1 },
  Triceps: { triceps: 1 },
  Legs: { quads: 1, glutes: 0.5, hams: 0.5 },
  Quads: { quads: 1 },
  Hamstrings: { hams: 1, glutes: 0.5 },
  Glutes: { glutes: 1, hams: 0.5 },
  Calves: { calves: 1 },
  Core: { abs: 1 },
}

// Per-exercise overrides for lifts whose single tag misleads (takes priority
// over TAG_CONTRIB). Keyed by exercise_key. Deadlift is tagged "Back" but is
// really posterior-chain.
export const EXERCISE_OVERRIDE: Record<string, Partial<Record<RegionId, number>>> = {
  deadlift: { hams: 1, glutes: 1, back: 0.5 },
}

// Built-in exercise_key -> muscle tag.
export const BUILTIN_TAG: Record<string, string> = Object.fromEntries(
  EXERCISES.map((e) => [e.key, e.muscle]),
)

// Heat scale anchored to the evidence-based ~10-20 sets/week guideline.
// Redder = more sets; 0 returns null (renders neutral).
export const HEAT_STOPS: { color: string; label: string }[] = [
  { color: '#F7C1C1', label: '1–5' },
  { color: '#F09595', label: '6–10' },
  { color: '#E24B4A', label: '11–15' },
  { color: '#A32D2D', label: '16–20' },
  { color: '#501313', label: '20+' },
]

export function heatColor(sets: number): string | null {
  if (sets <= 0) return null
  if (sets < 6) return HEAT_STOPS[0].color
  if (sets < 11) return HEAT_STOPS[1].color
  if (sets < 16) return HEAT_STOPS[2].color
  if (sets < 21) return HEAT_STOPS[3].color
  return HEAT_STOPS[4].color
}

export function volumeStatus(sets: number): string {
  if (sets >= 21) return 'high · above target'
  if (sets >= 10) return 'in range'
  if (sets > 0) return 'building · below target'
  return 'none logged'
}
