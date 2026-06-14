// Logic layer for the muscle-volume heatmap. Three decoupled layers keep the
// map extensible (see EnhancementsPlanning.txt):
//   1. exercise muscle tags (source, coarse) — src/data/exercises.ts + custom_exercises
//   2. SVG geometry (vendored) — src/data/bodyGeometry.ts
//   3. mapping (this file): tag/exercise -> our regions, and asset slug -> region
import { EXERCISES } from '@/data/exercises'

// Our logical muscle regions. Back is split traps / upper-back / lats / erector;
// core is split obliques / rectus / lower abs; delts are front / side / rear.
export type RegionId =
  | 'chest'
  | 'shoulders' // front delt
  | 'side_delts'
  | 'rear_delts'
  | 'biceps'
  | 'triceps'
  | 'forearm'
  | 'trapezius'
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
  'trapezius',
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
  trapezius: 'Trapezius',
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
  trapezius: 'trapezius',
  calves: 'calves',
}
const BACK_SLUG_REGION: Record<string, RegionId> = {
  deltoids: 'rear_delts',
  triceps: 'triceps',
  'lower-back': 'erector_spinae',
  trapezius: 'trapezius',
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
  Trapezius: { trapezius: 1 },
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
  face_pull: { rear_delts: 1, trapezius: 0.5, upper_back: 0.5 },
  // posterior chain
  deadlift: { hams: 1, glutes: 1, erector_spinae: 0.5, trapezius: 0.5 },
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
  'neutral grip pull ups': { lats: 1, biceps: 0.5, upper_back: 0.5, forearm: 0.5 },
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
  'flexion row': { upper_back: 1, lats: 0.5 },
  'w raise': { upper_back: 1, rear_delts: 0.5 },
  // back — rear delt
  'rear delt rows': { rear_delts: 1, upper_back: 0.5 },
  'inclined rear delt rows': { rear_delts: 1, upper_back: 0.5 },
  'row deltoid': { rear_delts: 1, upper_back: 0.5 },
  'reverse rear delt cable flys': { rear_delts: 1, upper_back: 0.5 },
  'inclined dumbbell face pulls': { rear_delts: 1, upper_back: 0.5 },
  'inclined y raises': { rear_delts: 1, trapezius: 0.5 },
  // back — traps / erector
  'dumbbell shoulder shrug': { trapezius: 1 },
  'barbell shoulder shrugs': { trapezius: 1 },
  'scapula depressions': { trapezius: 1, upper_back: 0.5 },
  'farmers walk': { trapezius: 1, erector_spinae: 0.5, forearm: 0.5 },
  'back extension': { erector_spinae: 1, glutes: 0.5 },
  'inclined back extensions': { erector_spinae: 1, glutes: 0.5 },
  supermans: { erector_spinae: 1, glutes: 0.5 },
  'good mornings': { hams: 1, glutes: 0.5, erector_spinae: 0.5 },
  // legs
  'bulgarian split squat': { quads: 1, glutes: 1 },
  // arms — forearm-heavy curls
  'cross body hammer curl': { biceps: 1, forearm: 0.5 },
  'rope hammer curls': { biceps: 1, forearm: 0.5 },
  'zottman curl': { biceps: 1, forearm: 0.5 },
  // triceps — compound (chest assist)
  'close grip bench press': { triceps: 1, chest: 0.5 },
  'close grip dumbbell bench press': { triceps: 1, chest: 0.5 },
  'reverse grip cable pull down': { triceps: 1, chest: 0.5 },
  'cross chest dumbbell extension': { triceps: 1, chest: 0.5 },
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
