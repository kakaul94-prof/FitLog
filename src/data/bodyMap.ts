// Logic layer for the muscle-volume heatmap. Three decoupled layers keep the
// map extensible (see EnhancementsPlanning.txt):
//   1. exercise muscle tags (source, coarse) — src/data/exercises.ts + custom_exercises
//   2. SVG geometry (vendored) — src/data/bodyGeometry.ts
//   3. mapping (this file): tag/exercise -> our regions, and asset slug -> region
import { EXERCISES } from '@/data/exercises'
import { normalizeExerciseName } from '@/data/exerciseAliases'

// Our logical muscle regions. Back is split upper-back (traps folded in) / lats / erector;
// core is split obliques / rectus / lower abs; delts are front / side / rear.
export type RegionId =
  | 'chest'
  | 'shoulders' // front delt
  | 'side_delts'
  | 'rear_delts'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'upper_back'
  | 'lats'
  | 'erector_spinae'
  | 'quads'
  | 'hams'
  | 'glutes'
  | 'calves'
  | 'obliques'
  | 'rectus_abdominis'
  | 'lower_abs'

export const REGION_IDS: RegionId[] = [
  'chest',
  'shoulders',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearm',
  'upper_back',
  'lats',
  'erector_spinae',
  'quads',
  'hams',
  'glutes',
  'calves',
  'obliques',
  'rectus_abdominis',
  'lower_abs',
]

export const REGION_LABEL: Record<RegionId, string> = {
  chest: 'Chest',
  shoulders: 'Front delt',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearm: 'Forearms',
  upper_back: 'Upper back',
  lats: 'Lats',
  erector_spinae: 'Erector spinae',
  quads: 'Quads',
  hams: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  obliques: 'Obliques',
  rectus_abdominis: 'Rectus abdominis',
  lower_abs: 'Lower abs',
}

// Vendored asset slug -> our region, per view. Three slugs are split in
// BodyHeatmap and so are NOT listed here (they'd resolve to a single region):
//   front "deltoids"  -> shoulders (inner) / side_delts (outer)  [vertical clip]
//   front "abs"       -> rectus_abdominis (upper) / lower_abs (lower)  [by path]
//   back  "upper-back"-> upper_back (upper) / lats (lower)  [by path]
// Any slug not listed (forearm-on-front renders, adductors, neck, head…) is
// neutral, so the figure reads like an anatomy chart with only trained muscles lit.
const FRONT_SLUG_REGION: Record<string, RegionId> = {
  chest: 'chest',
  deltoids: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearm',
  obliques: 'obliques',
  quadriceps: 'quads',
  trapezius: 'upper_back',
  calves: 'calves',
}
const BACK_SLUG_REGION: Record<string, RegionId> = {
  deltoids: 'rear_delts',
  triceps: 'triceps',
  'lower-back': 'erector_spinae',
  trapezius: 'upper_back',
  gluteal: 'glutes',
  hamstring: 'hams',
  calves: 'calves',
  forearm: 'forearm',
}

export function regionForSlug(side: 'front' | 'back', slug: string): RegionId | null {
  return (side === 'front' ? FRONT_SLUG_REGION : BACK_SLUG_REGION)[slug] ?? null
}

// Coarse exercise muscle tag -> region weights (primary 1.0, secondary 0.5).
// This is the FALLBACK for customs not pinned by NAME_CONTRIB; generic tags
// spread sensibly (a bare "Back" set splits lats/upper-back, a bare "Core" set
// across the ab regions).
export const TAG_CONTRIB: Record<string, Partial<Record<RegionId, number>>> = {
  Chest: { chest: 1, triceps: 0.5, shoulders: 0.5 },
  Back: { upper_back: 0.5, lats: 0.5, biceps: 0.5 },
  'Rear Delts': { rear_delts: 1 },
  Shoulders: { shoulders: 1, triceps: 0.5 },
  Biceps: { biceps: 1 },
  Triceps: { triceps: 1 },
  Legs: { quads: 1, glutes: 0.5, hams: 0.5 },
  Quads: { quads: 1 },
  Hamstrings: { hams: 1, glutes: 0.5 },
  Glutes: { glutes: 1, hams: 0.5 },
  Calves: { calves: 1 },
  Forearm: { forearm: 1 },
  Trapezius: { upper_back: 1 },
  Obliques: { obliques: 1 },
  Core: { rectus_abdominis: 0.5, lower_abs: 0.25, obliques: 0.25 },
}

// The importer (scripts/import-workouts.mjs) stores a custom exercise's muscle
// as the CSV parenthetical verbatim, so tags arrive in many forms: singular
// ("Tricep"), bicep-head labels ("Long Head Bicep"), "Abs" for Core, odd
// casing. Resolve any of them to a TAG_CONTRIB key.
const normTag = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const TAG_BY_NORM: Record<string, string> = {
  ...Object.fromEntries(Object.keys(TAG_CONTRIB).map((k) => [normTag(k), k])),
  tricep: 'Triceps',
  bicep: 'Biceps',
  'long head bicep': 'Biceps',
  'short head bicep': 'Biceps',
  abs: 'Core',
  shoulder: 'Shoulders',
  'lower back': 'Back',
  forearms: 'Forearm',
}

/** Region weights for a muscle tag, tolerant of synonyms / casing / plurals. */
export function contribForTag(
  tag: string | null | undefined,
): Partial<Record<RegionId, number>> | undefined {
  if (!tag) return undefined
  const canonical = TAG_BY_NORM[normTag(tag)]
  return canonical ? TAG_CONTRIB[canonical] : undefined
}

// Per-exercise overrides keyed by built-in exercise_key (takes priority over
// the tag). Covers built-ins + the many imported lifts that alias to a built-in
// key (see scripts/import-workouts.mjs BUILTIN_ALIASES).
export const EXERCISE_OVERRIDE: Record<string, Partial<Record<RegionId, number>>> = {
  // chest
  chest_fly: { chest: 1 },
  dip: { chest: 1, triceps: 1, shoulders: 0.5 },
  // back — pulls
  pull_up: { lats: 1, biceps: 0.5, upper_back: 0.5 },
  chin_up: { lats: 1, biceps: 1 },
  lat_pulldown: { lats: 1, biceps: 0.5 },
  barbell_row: { upper_back: 1, lats: 0.5, biceps: 0.5 },
  db_row: { upper_back: 1, lats: 0.5, biceps: 0.5 },
  seated_cable_row: { upper_back: 1, lats: 0.5, biceps: 0.5 },
  face_pull: { rear_delts: 1, upper_back: 1 },
  // posterior chain
  deadlift: { hams: 1, glutes: 1, erector_spinae: 0.5, upper_back: 0.5 },
  romanian_deadlift: { hams: 1, glutes: 1, erector_spinae: 0.5 },
  // legs
  front_squat: { quads: 1, glutes: 0.5 },
  leg_curl: { hams: 1 },
  lunge: { quads: 1, glutes: 1 },
  // arms
  hammer_curl: { biceps: 1, forearm: 0.5 },
  // core
  crunch: { rectus_abdominis: 1 },
  hanging_leg_raise: { lower_abs: 1 },
}

// Name-based region overrides for customs, matched on the *normalized exercise
// name* (normalizeExerciseName) — portable since customs are keyed by a per-user
// custom:<uuid> we can't reference, and it beats a coarse muscle tag. Checked
// after EXERCISE_OVERRIDE, before the tag.
export const NAME_CONTRIB: Record<string, Partial<Record<RegionId, number>>> = {
  // shoulders — side delt
  'lateral raise': { side_delts: 1 },
  'side cable lateral raises': { side_delts: 1 },
  'cable side later raise': { side_delts: 1 },
  'lateral raises cable': { side_delts: 1 },
  'seated side lateral raises': { side_delts: 1 },
  'inclined lateral raises': { side_delts: 1 },
  // shoulders — front delt raises (drop the press-tag triceps)
  'around the world': { shoulders: 1 },
  'front raise': { shoulders: 1 },
  'seated front hammer raises': { shoulders: 1 },
  // back — lats
  'wide grip pull up': { lats: 1, biceps: 0.5, upper_back: 0.5 },
  'neutral grip pull ups': { lats: 1, biceps: 0.5, upper_back: 0.5, forearm: 0.5, rear_delts: 0.5 },
  'band assisted pull up': { lats: 1, biceps: 0.5, upper_back: 0.5 },
  'assisted pull ups': { lats: 1, biceps: 0.5, upper_back: 0.5 },
  'band assisted chin up': { lats: 1, biceps: 1 },
  'underhand lat pull down': { lats: 1, biceps: 0.5 },
  'wide grip lat pulldown': { lats: 1, upper_back: 0.5 },
  'straight arm pull down': { lats: 1 },
  'lat prayers': { lats: 1 },
  'cross bench pull overs': { lats: 1, chest: 0.5 },
  // back — upper back / rhomboids
  'reverse grip bent over rows': { upper_back: 1, lats: 0.5, biceps: 0.5 },
  'high row': { upper_back: 1, lats: 0.5 },
  't bar row': { upper_back: 1, lats: 0.5, biceps: 0.5 },
  'chest supported rows': { upper_back: 1, lats: 0.5, rear_delts: 0.5 },
  'flexion row': { erector_spinae: 1, lats: 0.5 },
  'w raise': { upper_back: 1, rear_delts: 0.5 },
  // back — rear delt
  'rear delt rows': { rear_delts: 1, upper_back: 0.5 },
  'inclined rear delt rows': { rear_delts: 1, upper_back: 0.5 },
  'row deltoid': { rear_delts: 1, upper_back: 0.5 },
  'reverse rear delt cable flys': { rear_delts: 1, upper_back: 0.5 },
  'inclined dumbbell face pulls': { rear_delts: 1, upper_back: 0.5 },
  'inclined y raises': { rear_delts: 1, upper_back: 0.5 },
  // back — custom Back-tagged rows/pulldowns: generic back spread + 0.5 rear-delt accessory
  'face pulls': { upper_back: 0.5, lats: 0.5, biceps: 0.5, rear_delts: 0.5 },
  'lat pull down': { upper_back: 0.5, lats: 1, biceps: 0.5, rear_delts: 0.5 },
  'pull ups': { upper_back: 0.5, lats: 1, biceps: 0.5, rear_delts: 0.5 },
  'seated row': { upper_back: 0.5, lats: 1, biceps: 0.5, rear_delts: 0.5 },
  // back — traps (folded into upper back) / erector
  'dumbbell shoulder shrug': { upper_back: 1 },
  'barbell shoulder shrugs': { upper_back: 1 },
  shrugs: { upper_back: 1 },
  'scapula depressions': { upper_back: 1.5 },
  'farmers walk': { upper_back: 1, erector_spinae: 0.5, forearm: 0.5 },
  'back extension': { erector_spinae: 1, glutes: 0.5 },
  'inclined back extensions': { erector_spinae: 1, glutes: 0.5 },
  supermans: { erector_spinae: 1, glutes: 0.5 },
  'good mornings': { hams: 1, glutes: 0.5, erector_spinae: 0.5 },
  // legs
  'bulgarian split squat': { quads: 1, glutes: 1 },
  squat: { quads: 1, glutes: 0.5 },
  'front squat': { quads: 1, glutes: 0.5 },
  'leg extension': { quads: 1 },
  'dumbbell romanian deadlift': { hams: 1, glutes: 1, erector_spinae: 0.5 },
  'dumbbell romanian deadlifts': { hams: 1, glutes: 1, erector_spinae: 0.5 },
  'barbell romanian deadlifts': { hams: 1, glutes: 1, erector_spinae: 0.5 },
  // tibialis is the antagonist of the calf; no shin region exists, so folded
  // into calves (lower leg) by user preference.
  'tibialis raises': { calves: 1 },
  // arms — forearm-heavy curls
  'cross body hammer curl': { biceps: 1, forearm: 0.5 },
  'rope hammer curls': { biceps: 1, forearm: 0.5 },
  'zottman curl': { biceps: 1, forearm: 0.5 },
  'reverse curls': { forearm: 1, biceps: 0.5 },
  // triceps — compound (chest assist)
  'close grip bench press': { triceps: 1, chest: 0.5 },
  'close grip dumbbell bench press': { triceps: 1, chest: 0.5 },
  'reverse grip cable pull down': { triceps: 1, chest: 0.5 },
  'cross chest dumbbell extension': { triceps: 1, chest: 0.5 },
  // triceps — isolation
  'overhead tricep cable extensions': { triceps: 1 },
  // chest — the bare "Cable (Chest L/R)" tag is unmappable; pin by name
  cable: { chest: 1 },
  // core — rectus (upper)
  'cable crunch': { rectus_abdominis: 1 },
  'bench abs crunch': { rectus_abdominis: 1 },
  'yoga ball crunches': { rectus_abdominis: 1 },
  'yoga ball circular crunches': { rectus_abdominis: 1 },
  'bosu ball crunches': { rectus_abdominis: 1 },
  'accordion crunches': { rectus_abdominis: 1, lower_abs: 0.5 },
  'dragon flags': { rectus_abdominis: 1, lower_abs: 1 },
  // core — lower
  'leg raises': { lower_abs: 1 },
  'mountain climbers': { lower_abs: 0.5, rectus_abdominis: 0.5 },
  // core — obliques
  'rotary torso': { obliques: 1 },
  'torso rotation': { obliques: 1 },
  'cable wood chops': { obliques: 1 },
  'medicine ball wood chops': { obliques: 1 },
  'weighted oblique crunches': { obliques: 1 },
  'russian twists': { obliques: 1 },
  'side planks': { obliques: 1 },
  'windshield wipers': { obliques: 1, lower_abs: 0.5 },
  'spider man planks': { obliques: 1, rectus_abdominis: 0.5 },
  // core — whole / stability
  'bird dog': { rectus_abdominis: 0.5, erector_spinae: 0.5, glutes: 0.5 },
  deadbugs: { rectus_abdominis: 0.5, erector_spinae: 0.5, glutes: 0.5 },
}

// Built-in exercise_key -> muscle tag.
export const BUILTIN_TAG: Record<string, string> = Object.fromEntries(
  EXERCISES.map((e) => [e.key, e.muscle]),
)

// --- Weekly set goals -------------------------------------------------------
// Default sets/week target per region — sensible evidence-based starting points
// (bigger muscles higher); the user overrides any of them in the Set-goals
// editor (profiles.volume_targets). 0 means "untracked": that region stays
// neutral on the map.
export const DEFAULT_GOALS: Record<RegionId, number> = {
  chest: 14,
  shoulders: 8, // front delt — gets a lot of indirect work from pressing
  side_delts: 12,
  rear_delts: 12,
  biceps: 12,
  triceps: 12,
  forearm: 6,
  upper_back: 14,
  lats: 14,
  erector_spinae: 8,
  quads: 14,
  hams: 12,
  glutes: 12,
  calves: 12,
  obliques: 8,
  rectus_abdominis: 10,
  lower_abs: 8,
}

/** Merge a user's stored per-muscle goals over the defaults — tolerates a sparse
 *  map and regions added after the user last saved (they inherit the default). */
export function resolveGoals(
  stored: Record<string, number> | null | undefined,
): Record<RegionId, number> {
  const out = { ...DEFAULT_GOALS }
  if (stored) {
    for (const r of REGION_IDS) {
      const v = stored[r]
      if (typeof v === 'number' && v >= 0) out[r] = v
    }
  }
  return out
}

// Heat scale is RELATIVE to each muscle's goal: redder = closer to / over the
// goal. 5 stops from "far below" to "over goal". 0 sets, or a 0 (untracked)
// goal, returns null and renders neutral.
export const HEAT_STOPS: { color: string; label: string }[] = [
  { color: '#F7C1C1', label: 'far' },
  { color: '#F09595', label: 'under' },
  { color: '#E24B4A', label: 'near' },
  { color: '#A32D2D', label: 'at goal' },
  { color: '#501313', label: 'over' },
]

/** Color for `sets` performed against this muscle's weekly `goal`.
 *  null = neutral (no sets logged, or no goal set). */
export function heatColor(sets: number, goal: number): string | null {
  if (sets <= 0 || goal <= 0) return null
  const p = sets / goal
  if (p < 0.5) return HEAT_STOPS[0].color
  if (p < 0.85) return HEAT_STOPS[1].color
  if (p < 1.0) return HEAT_STOPS[2].color
  if (p < 1.3) return HEAT_STOPS[3].color
  return HEAT_STOPS[4].color
}

export function volumeStatus(sets: number, goal: number): string {
  if (goal <= 0) return 'no goal set'
  if (sets <= 0) return 'none logged'
  const p = sets / goal
  if (p < 0.85) return 'under goal'
  if (p < 1.0) return 'near goal'
  if (p < 1.3) return 'at goal'
  return 'over goal'
}

/** Resolve one exercise's fractional muscle-region contribution, in priority
 *  order: per-key override → normalized-name match → tag (a built-in's muscle,
 *  or a custom exercise's `muscle`). undefined = unmapped. Shared by logged
 *  volume (useMuscleVolume) and planned volume (the program). `customTag` maps
 *  `custom:<id>` → its muscle. */
export function resolveContrib(
  exerciseKey: string,
  exerciseName: string | null,
  customTag: Map<string, string | null>,
): Partial<Record<RegionId, number>> | undefined {
  const tag = exerciseKey.startsWith('custom:')
    ? customTag.get(exerciseKey) ?? null
    : BUILTIN_TAG[exerciseKey] ?? null
  const nameContrib = exerciseName
    ? NAME_CONTRIB[normalizeExerciseName(exerciseName)]
    : undefined
  return EXERCISE_OVERRIDE[exerciseKey] ?? nameContrib ?? contribForTag(tag)
}
