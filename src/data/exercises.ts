// Built-in strength exercise library. Custom exercises are stored per-user.
export type ExKind = 'weighted' | 'bodyweight' | 'timed'

export interface BuiltinExercise {
  key: string
  name: string
  muscle: string
  equipment: string
  kind: ExKind
}

export const EXERCISES: BuiltinExercise[] = [
  // Chest
  { key: 'bench_press', name: 'Bench Press', muscle: 'Chest', equipment: 'Barbell', kind: 'weighted' },
  { key: 'incline_bench_press', name: 'Incline Bench Press', muscle: 'Chest', equipment: 'Barbell', kind: 'weighted' },
  { key: 'db_bench_press', name: 'Dumbbell Bench Press', muscle: 'Chest', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'chest_fly', name: 'Chest Fly', muscle: 'Chest', equipment: 'Cable', kind: 'weighted' },
  { key: 'push_up', name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight', kind: 'bodyweight' },
  // Back
  { key: 'deadlift', name: 'Deadlift', muscle: 'Back', equipment: 'Barbell', kind: 'weighted' },
  { key: 'pull_up', name: 'Pull-Up', muscle: 'Back', equipment: 'Bodyweight', kind: 'bodyweight' },
  { key: 'chin_up', name: 'Chin-Up', muscle: 'Back', equipment: 'Bodyweight', kind: 'bodyweight' },
  { key: 'lat_pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: 'Cable', kind: 'weighted' },
  { key: 'barbell_row', name: 'Barbell Row', muscle: 'Back', equipment: 'Barbell', kind: 'weighted' },
  { key: 'db_row', name: 'Dumbbell Row', muscle: 'Back', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'seated_cable_row', name: 'Seated Cable Row', muscle: 'Back', equipment: 'Cable', kind: 'weighted' },
  { key: 'face_pull', name: 'Face Pull', muscle: 'Rear Delts', equipment: 'Cable', kind: 'weighted' },
  // Legs
  { key: 'back_squat', name: 'Back Squat', muscle: 'Legs', equipment: 'Barbell', kind: 'weighted' },
  { key: 'front_squat', name: 'Front Squat', muscle: 'Legs', equipment: 'Barbell', kind: 'weighted' },
  { key: 'leg_press', name: 'Leg Press', muscle: 'Legs', equipment: 'Machine', kind: 'weighted' },
  { key: 'lunge', name: 'Lunge', muscle: 'Legs', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'romanian_deadlift', name: 'Romanian Deadlift', muscle: 'Hamstrings', equipment: 'Barbell', kind: 'weighted' },
  { key: 'leg_curl', name: 'Leg Curl', muscle: 'Hamstrings', equipment: 'Machine', kind: 'weighted' },
  { key: 'leg_extension', name: 'Leg Extension', muscle: 'Quads', equipment: 'Machine', kind: 'weighted' },
  { key: 'calf_raise', name: 'Calf Raise', muscle: 'Calves', equipment: 'Machine', kind: 'weighted' },
  { key: 'hip_thrust', name: 'Hip Thrust', muscle: 'Glutes', equipment: 'Barbell', kind: 'weighted' },
  // Shoulders
  { key: 'overhead_press', name: 'Overhead Press', muscle: 'Shoulders', equipment: 'Barbell', kind: 'weighted' },
  { key: 'db_shoulder_press', name: 'Dumbbell Shoulder Press', muscle: 'Shoulders', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'lateral_raise', name: 'Lateral Raise', muscle: 'Shoulders', equipment: 'Dumbbell', kind: 'weighted' },
  // Arms
  { key: 'barbell_curl', name: 'Barbell Curl', muscle: 'Biceps', equipment: 'Barbell', kind: 'weighted' },
  { key: 'db_curl', name: 'Dumbbell Curl', muscle: 'Biceps', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'hammer_curl', name: 'Hammer Curl', muscle: 'Biceps', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'tricep_pushdown', name: 'Tricep Pushdown', muscle: 'Triceps', equipment: 'Cable', kind: 'weighted' },
  { key: 'overhead_tricep_ext', name: 'Overhead Tricep Extension', muscle: 'Triceps', equipment: 'Dumbbell', kind: 'weighted' },
  { key: 'dip', name: 'Dip', muscle: 'Triceps', equipment: 'Bodyweight', kind: 'bodyweight' },
  // Core
  { key: 'plank', name: 'Plank', muscle: 'Core', equipment: 'Bodyweight', kind: 'timed' },
  { key: 'crunch', name: 'Crunch', muscle: 'Core', equipment: 'Bodyweight', kind: 'bodyweight' },
  { key: 'hanging_leg_raise', name: 'Hanging Leg Raise', muscle: 'Core', equipment: 'Bodyweight', kind: 'bodyweight' },
]
