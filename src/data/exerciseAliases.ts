// Resolve an exercise *name* to a built-in lift key, so the Form tab can show
// built-in cues for lifts logged under a custom: key (e.g. the MyFitnessPal
// import, which stores every lift as a custom exercise).
//
// Most targets are built-in lift keys. A few are form-only keys for common
// variants with no built-in equivalent (incline_db_press, cable_crunch); these
// exist in exerciseForm.ts but not the picker, so they're used ONLY for cue
// lookup, never as a stored exercise_key. Deliberately left unmapped (a built-
// in's cues would mislead): close-grip bench, cable lateral raise, DB military
// press, flat-bench DB fly, etc. Built-in names resolve automatically below.
import { EXERCISES } from './exercises'

/** lowercase · drop trailing "(muscle)" tags · strip punctuation · collapse spaces */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // (Chest), (Back), (long Head Bicep)…
    .replace(/[^a-z0-9]+/g, ' ') // hyphens / slashes / punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

// Normalized custom/import name → built-in key. (Names that already equal a
// built-in's name are covered by BUILTIN_BY_NAME and need no entry here.)
// Mirrored by BUILTIN_ALIASES in scripts/import-workouts.mjs (real keys only).
const NAME_ALIASES: Record<string, string> = {
  squat: 'back_squat',
  'pull ups': 'pull_up',
  'lat pull down': 'lat_pulldown',
  'inclined bench press': 'incline_bench_press',
  'face pulls': 'face_pull',
  'hip thrusts': 'hip_thrust',
  'dumbbell romanian deadlift': 'romanian_deadlift',
  'barbell romanian deadlifts': 'romanian_deadlift',
  'one arm dumbbell rows': 'db_row',
  'dumbbell walking lunges': 'lunge',
  'dumbbell overhead press': 'db_shoulder_press',
  'seated dumbbell press': 'db_shoulder_press',
  'bent over rows': 'barbell_row',
  'seated row': 'seated_cable_row',
  planks: 'plank',
  dips: 'dip',
  'push ups': 'push_up',
  'standing calf': 'calf_raise',
  'cable flys': 'chest_fly',
  'cable pull down': 'tricep_pushdown',
  'alternating dumbbell bicep curl': 'db_curl',
  'bicep curls': 'barbell_curl',
  'low row': 'seated_cable_row',
  'seated dip': 'dip',
  'seated dips': 'dip',
}

// Form-only cue keys (defined in exerciseForm.ts, NOT real exercise keys / not
// in the picker). Kept separate so the importer never assigns them as a key.
const FORM_ONLY_ALIASES: Record<string, string> = {
  'inclined dumbbell press': 'incline_db_press',
  'cable crunch': 'cable_crunch',
}

// Built-in lift names resolve to their own key (covers bare "Deadlift",
// "Front Squat", "Lateral Raise", app-picked built-ins logged by name, etc.).
const BUILTIN_BY_NAME: Record<string, string> = Object.fromEntries(
  EXERCISES.map((e) => [normalizeExerciseName(e.name), e.key]),
)

/** Best-effort built-in lift key for an exercise name (undefined if none). */
export function builtinKeyForName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const n = normalizeExerciseName(name)
  return NAME_ALIASES[n] ?? FORM_ONLY_ALIASES[n] ?? BUILTIN_BY_NAME[n]
}
