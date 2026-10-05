// Ready-made lifting splits offered by Program → Change program. Each preset is
// a pure description: picking one creates a `routines` row per day (plus its
// `routine_exercises`) and writes a matching rotation into profiles.program.
// Nothing here is stored — the user's copy is theirs to edit afterwards.
import { EXERCISES } from './exercises'

/** One prescribed lift in a preset day. `superset` groups items trained back
 *  to back (shared superset_group on the created routine_exercises rows). */
export interface PresetExercise {
  key: string
  sets: number
  reps: number
  superset?: number
}

export interface PresetDay {
  name: string
  exercises: PresetExercise[]
}

/** A slot in the preset rotation: a training day or a rest day. */
export type PresetSlot = PresetDay | 'rest'

export interface PresetProgram {
  id: string
  name: string
  /** One-line shape, e.g. "4 days · 2× per muscle each week". */
  shape: string
  /** Why you'd pick this one, in a sentence. */
  blurb: string
  /** lucide-react icon name rendered on the picker row. */
  icon: 'LayoutGrid' | 'Split' | 'PersonStanding' | 'TrendingUp'
  slots: PresetSlot[]
}

const NAME_BY_KEY = new Map(EXERCISES.map((e) => [e.key, e.name]))

/** Display name for a preset item's exercise key (falls back to the key so a
 *  preset referencing a lift that later leaves the library still renders). */
export const presetExerciseName = (key: string) => NAME_BY_KEY.get(key) ?? key

export const isPresetDay = (slot: PresetSlot): slot is PresetDay =>
  slot !== 'rest'

/** Training days in a preset, rest slots dropped. */
export const presetDays = (p: PresetProgram): PresetDay[] =>
  p.slots.filter(isPresetDay)

/** Summed target sets across every day — the "N sets per cycle" readout. */
export const presetTotalSets = (p: PresetProgram): number =>
  presetDays(p).reduce(
    (total, day) => total + day.exercises.reduce((s, e) => s + e.sets, 0),
    0,
  )

/** Composition line for a preset, e.g. "8 days · 6 lift · 2 rest". */
export function presetShapeLine(p: PresetProgram): string {
  const rests = p.slots.length - presetDays(p).length
  const parts = [
    `${p.slots.length}-day cycle`,
    `${presetDays(p).length} lift`,
    ...(rests > 0 ? [`${rests} rest`] : []),
  ]
  return parts.join(' · ')
}

export const PROGRAMS: PresetProgram[] = [
  {
    id: 'upper_lower',
    name: 'Upper / lower',
    shape: '4 days · 2× per muscle each week',
    blurb: 'Best all-round balance of frequency and recovery.',
    icon: 'LayoutGrid',
    slots: [
      {
        name: 'Upper A',
        exercises: [
          { key: 'bench_press', sets: 4, reps: 6 },
          { key: 'barbell_row', sets: 4, reps: 8 },
          { key: 'db_shoulder_press', sets: 3, reps: 10 },
          { key: 'lat_pulldown', sets: 3, reps: 10 },
          { key: 'lateral_raise', sets: 3, reps: 15 },
          { key: 'tricep_pushdown', sets: 3, reps: 12, superset: 1 },
          { key: 'db_curl', sets: 3, reps: 12, superset: 1 },
        ],
      },
      {
        name: 'Lower A',
        exercises: [
          { key: 'back_squat', sets: 4, reps: 6 },
          { key: 'romanian_deadlift', sets: 3, reps: 8 },
          { key: 'leg_press', sets: 3, reps: 12 },
          { key: 'leg_curl', sets: 3, reps: 12 },
          { key: 'calf_raise', sets: 4, reps: 15 },
          { key: 'hanging_leg_raise', sets: 3, reps: 12 },
        ],
      },
      'rest',
      {
        name: 'Upper B',
        exercises: [
          { key: 'overhead_press', sets: 4, reps: 6 },
          { key: 'pull_up', sets: 4, reps: 8 },
          { key: 'incline_bench_press', sets: 3, reps: 10 },
          { key: 'seated_cable_row', sets: 3, reps: 10 },
          { key: 'face_pull', sets: 3, reps: 15 },
          { key: 'hammer_curl', sets: 3, reps: 12, superset: 1 },
          { key: 'overhead_tricep_ext', sets: 3, reps: 12, superset: 1 },
        ],
      },
      {
        name: 'Lower B',
        exercises: [
          { key: 'deadlift', sets: 3, reps: 5 },
          { key: 'front_squat', sets: 3, reps: 8 },
          { key: 'hip_thrust', sets: 3, reps: 10 },
          { key: 'lunge', sets: 3, reps: 10 },
          { key: 'leg_extension', sets: 3, reps: 15 },
          { key: 'calf_raise', sets: 4, reps: 15 },
        ],
      },
      'rest',
      'rest',
    ],
  },
  {
    id: 'ppl',
    name: 'Push / pull / legs',
    shape: '6 days · A and B variants',
    blurb: 'Cleanest fatigue separation, highest weekly volume.',
    icon: 'Split',
    slots: [
      {
        name: 'Push A',
        exercises: [
          { key: 'bench_press', sets: 4, reps: 6 },
          { key: 'overhead_press', sets: 3, reps: 8 },
          { key: 'incline_bench_press', sets: 3, reps: 10 },
          { key: 'lateral_raise', sets: 4, reps: 15 },
          { key: 'tricep_pushdown', sets: 3, reps: 12 },
          { key: 'overhead_tricep_ext', sets: 3, reps: 12 },
        ],
      },
      {
        name: 'Pull A',
        exercises: [
          { key: 'deadlift', sets: 3, reps: 5 },
          { key: 'pull_up', sets: 4, reps: 8 },
          { key: 'barbell_row', sets: 3, reps: 8 },
          { key: 'face_pull', sets: 3, reps: 15 },
          { key: 'barbell_curl', sets: 3, reps: 10 },
          { key: 'hammer_curl', sets: 3, reps: 12 },
        ],
      },
      {
        name: 'Legs A',
        exercises: [
          { key: 'back_squat', sets: 4, reps: 6 },
          { key: 'romanian_deadlift', sets: 3, reps: 8 },
          { key: 'leg_press', sets: 3, reps: 12 },
          { key: 'leg_curl', sets: 3, reps: 12 },
          { key: 'calf_raise', sets: 4, reps: 15 },
          { key: 'hanging_leg_raise', sets: 3, reps: 12 },
        ],
      },
      'rest',
      {
        name: 'Push B',
        exercises: [
          { key: 'db_bench_press', sets: 4, reps: 10 },
          { key: 'db_shoulder_press', sets: 3, reps: 10 },
          { key: 'chest_fly', sets: 3, reps: 15 },
          { key: 'lateral_raise', sets: 4, reps: 15 },
          { key: 'dip', sets: 3, reps: 10 },
          { key: 'tricep_pushdown', sets: 3, reps: 15 },
        ],
      },
      {
        name: 'Pull B',
        exercises: [
          { key: 'lat_pulldown', sets: 4, reps: 10 },
          { key: 'seated_cable_row', sets: 4, reps: 10 },
          { key: 'db_row', sets: 3, reps: 12 },
          { key: 'face_pull', sets: 3, reps: 20 },
          { key: 'chin_up', sets: 3, reps: 8 },
          { key: 'db_curl', sets: 3, reps: 12 },
        ],
      },
      {
        name: 'Legs B',
        exercises: [
          { key: 'front_squat', sets: 4, reps: 8 },
          { key: 'hip_thrust', sets: 3, reps: 10 },
          { key: 'lunge', sets: 3, reps: 10 },
          { key: 'leg_extension', sets: 3, reps: 15 },
          { key: 'leg_curl', sets: 3, reps: 15 },
          { key: 'calf_raise', sets: 4, reps: 20 },
        ],
      },
      'rest',
    ],
  },
  {
    id: 'full_body',
    name: 'Full body',
    shape: '3 days · 3× per muscle each week',
    blurb: 'Highest frequency, and the most forgiving of a missed session.',
    icon: 'PersonStanding',
    slots: [
      {
        name: 'Full body A',
        exercises: [
          { key: 'back_squat', sets: 4, reps: 6 },
          { key: 'bench_press', sets: 4, reps: 6 },
          { key: 'barbell_row', sets: 3, reps: 8 },
          { key: 'lateral_raise', sets: 3, reps: 15 },
          { key: 'db_curl', sets: 3, reps: 12 },
          { key: 'hanging_leg_raise', sets: 3, reps: 12 },
        ],
      },
      'rest',
      {
        name: 'Full body B',
        exercises: [
          { key: 'deadlift', sets: 3, reps: 5 },
          { key: 'overhead_press', sets: 4, reps: 8 },
          { key: 'lat_pulldown', sets: 3, reps: 10 },
          { key: 'leg_press', sets: 3, reps: 12 },
          { key: 'tricep_pushdown', sets: 3, reps: 12 },
          { key: 'crunch', sets: 3, reps: 20 },
        ],
      },
      'rest',
      {
        name: 'Full body C',
        exercises: [
          { key: 'front_squat', sets: 3, reps: 8 },
          { key: 'incline_bench_press', sets: 4, reps: 8 },
          { key: 'pull_up', sets: 3, reps: 8 },
          { key: 'romanian_deadlift', sets: 3, reps: 10 },
          { key: 'face_pull', sets: 3, reps: 15 },
          { key: 'hammer_curl', sets: 3, reps: 12 },
          { key: 'calf_raise', sets: 3, reps: 15 },
        ],
      },
      'rest',
      'rest',
    ],
  },
  {
    id: 'ulppl',
    name: 'Upper / lower / push / pull / legs',
    shape: '5 days · strength block plus volume block',
    blurb: "The step up when four days isn't enough stimulus.",
    icon: 'TrendingUp',
    slots: [
      {
        name: 'Upper',
        exercises: [
          { key: 'bench_press', sets: 4, reps: 5 },
          { key: 'barbell_row', sets: 4, reps: 6 },
          { key: 'overhead_press', sets: 3, reps: 8 },
          { key: 'pull_up', sets: 3, reps: 8 },
          { key: 'face_pull', sets: 3, reps: 15 },
          { key: 'barbell_curl', sets: 3, reps: 10 },
        ],
      },
      {
        name: 'Lower',
        exercises: [
          { key: 'back_squat', sets: 4, reps: 5 },
          { key: 'romanian_deadlift', sets: 3, reps: 8 },
          { key: 'leg_press', sets: 3, reps: 10 },
          { key: 'leg_curl', sets: 3, reps: 12 },
          { key: 'calf_raise', sets: 4, reps: 15 },
        ],
      },
      'rest',
      {
        name: 'Push',
        exercises: [
          { key: 'incline_bench_press', sets: 4, reps: 10 },
          { key: 'db_shoulder_press', sets: 3, reps: 12 },
          { key: 'chest_fly', sets: 3, reps: 15 },
          { key: 'lateral_raise', sets: 4, reps: 15 },
          { key: 'dip', sets: 3, reps: 10 },
          { key: 'tricep_pushdown', sets: 3, reps: 15 },
        ],
      },
      {
        name: 'Pull',
        exercises: [
          { key: 'lat_pulldown', sets: 4, reps: 10 },
          { key: 'seated_cable_row', sets: 4, reps: 12 },
          { key: 'db_row', sets: 3, reps: 12 },
          { key: 'face_pull', sets: 3, reps: 20 },
          { key: 'db_curl', sets: 3, reps: 12 },
          { key: 'hammer_curl', sets: 3, reps: 15 },
        ],
      },
      {
        name: 'Legs',
        exercises: [
          { key: 'front_squat', sets: 4, reps: 8 },
          { key: 'hip_thrust', sets: 3, reps: 10 },
          { key: 'lunge', sets: 3, reps: 10 },
          { key: 'leg_extension', sets: 3, reps: 15 },
          { key: 'leg_curl', sets: 3, reps: 15 },
          { key: 'calf_raise', sets: 4, reps: 20 },
          { key: 'hanging_leg_raise', sets: 3, reps: 15 },
        ],
      },
      'rest',
    ],
  },
]

export const programById = (id: string | null | undefined) =>
  PROGRAMS.find((p) => p.id === id) ?? null
