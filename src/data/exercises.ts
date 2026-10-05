// Built-in strength exercise library. Custom exercises are stored per-user.
// 'timed' and 'mobility' are both logged as a hold in seconds rather than
// reps × weight; 'mobility' additionally groups the stretch library.
export type ExKind = 'weighted' | 'bodyweight' | 'timed' | 'mobility'

/** Kinds whose sets are a hold duration, not reps × weight. Also accepts the
 *  wider ExerciseType stored on custom exercises (which adds 'cardio'). */
export const isHoldKind = (kind: ExKind | 'cardio' | null | undefined) =>
  kind === 'timed' || kind === 'mobility'

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
  // Mobility — logged as a hold in seconds. Bilateral stretches count both
  // sides together (one hold entry), matching the Mobility list's minutes.
  { key: 'couch_stretch', name: 'Couch Stretch', muscle: 'Hip Flexors', equipment: 'Floor', kind: 'mobility' },
  { key: 'pigeon_pose', name: 'Pigeon Pose', muscle: 'Glutes', equipment: 'Floor', kind: 'mobility' },
  { key: 'ninety_ninety', name: '90/90 Hip Switch', muscle: 'Hips', equipment: 'Floor', kind: 'mobility' },
  { key: 'deep_squat_hold', name: 'Deep Squat Hold', muscle: 'Hips', equipment: 'Bodyweight', kind: 'mobility' },
  { key: 'horse_stance', name: 'Horse Stance', muscle: 'Hips', equipment: 'Bodyweight', kind: 'mobility' },
  { key: 'lizard_pose', name: 'Lizard Pose', muscle: 'Hips', equipment: 'Floor', kind: 'mobility' },
  { key: 'pancake_stretch', name: 'Pancake Stretch', muscle: 'Adductors', equipment: 'Floor', kind: 'mobility' },
  { key: 'butterfly_stretch', name: 'Butterfly Stretch', muscle: 'Adductors', equipment: 'Floor', kind: 'mobility' },
  { key: 'hamstring_stretch', name: 'Seated Hamstring Stretch', muscle: 'Hamstrings', equipment: 'Floor', kind: 'mobility' },
  { key: 'standing_quad_stretch', name: 'Standing Quad Stretch', muscle: 'Quads', equipment: 'Bodyweight', kind: 'mobility' },
  { key: 'calf_stretch', name: 'Calf Stretch', muscle: 'Calves', equipment: 'Wall', kind: 'mobility' },
  { key: 'worlds_greatest_stretch', name: "World's Greatest Stretch", muscle: 'Full Body', equipment: 'Bodyweight', kind: 'mobility' },
  { key: 'dead_hang', name: 'Dead Hang', muscle: 'Lats', equipment: 'Pull-Up Bar', kind: 'mobility' },
  { key: 'childs_pose', name: "Child's Pose", muscle: 'Lats', equipment: 'Floor', kind: 'mobility' },
  { key: 'doorway_chest_stretch', name: 'Doorway Chest Stretch', muscle: 'Chest', equipment: 'Wall', kind: 'mobility' },
  { key: 'thoracic_extension', name: 'Thoracic Extension', muscle: 'Upper Back', equipment: 'Foam Roller', kind: 'mobility' },
  { key: 'seated_spinal_twist', name: 'Seated Spinal Twist', muscle: 'Spine', equipment: 'Floor', kind: 'mobility' },
  { key: 'cat_cow', name: 'Cat-Cow', muscle: 'Spine', equipment: 'Floor', kind: 'mobility' },
  { key: 'shoulder_dislocates', name: 'Shoulder Dislocates', muscle: 'Shoulders', equipment: 'Band', kind: 'mobility' },
  { key: 'neck_side_stretch', name: 'Neck Side Stretch', muscle: 'Neck', equipment: 'Bodyweight', kind: 'mobility' },
  { key: 'wrist_flexor_stretch', name: 'Wrist Flexor Stretch', muscle: 'Forearms', equipment: 'Floor', kind: 'mobility' },
]

/** Built-in stretches, for the Mobility list's name suggestions. */
export const MOBILITY_EXERCISES = EXERCISES.filter((e) => e.kind === 'mobility')
