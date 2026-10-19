// Pre-workout check-in data: which joints each built-in lift loads, and what to
// swap it for when one of them hurts. Sites match PAIN_SITES in lib/rehab.ts
// ('other' is never mapped — there's nothing to reason about).
//
// "Loads" is a deliberately conservative judgement call — a site is listed when
// a sore one is likely to complain, not only when it's the prime mover. A lift
// with no entry here has no rule, and the check-in hands it to the trainer.

export const JOINT_STRESS: Record<string, string[]> = {
  // chest
  bench_press: ['shoulder', 'elbow', 'wrist'],
  incline_bench_press: ['shoulder', 'elbow', 'wrist'],
  db_bench_press: ['shoulder', 'elbow'],
  machine_chest_press: ['elbow'],
  db_floor_press: ['elbow'],
  chest_fly: ['shoulder'],
  push_up: ['shoulder', 'elbow', 'wrist'],
  dip: ['shoulder', 'elbow', 'wrist'],
  // back
  deadlift: ['low back', 'hip'],
  pull_up: ['shoulder', 'elbow'],
  chin_up: ['shoulder', 'elbow', 'wrist'],
  lat_pulldown: ['shoulder', 'elbow'],
  barbell_row: ['low back', 'elbow'],
  db_row: ['elbow'],
  seated_cable_row: ['elbow'],
  chest_supported_row: ['elbow'],
  face_pull: [],
  // legs
  back_squat: ['low back', 'knee', 'hip', 'shoulder'],
  front_squat: ['low back', 'knee', 'wrist'],
  safety_bar_squat: ['low back', 'knee', 'hip'],
  goblet_squat: ['knee', 'hip'],
  belt_squat: ['knee', 'hip'],
  leg_press: ['knee', 'hip'],
  lunge: ['knee', 'hip'],
  leg_extension: ['knee'],
  romanian_deadlift: ['low back', 'hip'],
  leg_curl: ['knee'],
  hip_thrust: ['hip'],
  cable_pull_through: ['hip'],
  calf_raise: [],
  // shoulders
  overhead_press: ['shoulder', 'low back', 'elbow', 'wrist'],
  db_shoulder_press: ['shoulder', 'elbow'],
  landmine_press: ['elbow'],
  lateral_raise: ['shoulder'],
  // arms
  barbell_curl: ['elbow', 'wrist'],
  db_curl: ['elbow'],
  hammer_curl: ['elbow'],
  tricep_pushdown: ['elbow'],
  overhead_tricep_ext: ['elbow', 'shoulder'],
  // core
  plank: [],
  crunch: ['low back'],
  hanging_leg_raise: ['shoulder', 'low back'],
}

/** Same-muscle alternatives, best first. The check-in picks the first one that
 *  doesn't load any sore site, so order = preference when everything's fine. */
export const SWAPS: Record<string, string[]> = {
  // chest
  bench_press: ['db_bench_press', 'machine_chest_press', 'db_floor_press', 'push_up'],
  incline_bench_press: ['db_bench_press', 'machine_chest_press', 'db_floor_press'],
  db_bench_press: ['machine_chest_press', 'db_floor_press', 'push_up'],
  machine_chest_press: ['db_floor_press', 'db_bench_press'],
  db_floor_press: ['machine_chest_press', 'db_bench_press'],
  chest_fly: ['machine_chest_press', 'db_floor_press'],
  push_up: ['machine_chest_press', 'db_floor_press', 'db_bench_press'],
  dip: ['db_floor_press', 'machine_chest_press', 'tricep_pushdown'],
  // back
  deadlift: ['romanian_deadlift', 'cable_pull_through', 'hip_thrust', 'leg_curl'],
  pull_up: ['lat_pulldown', 'chest_supported_row', 'seated_cable_row'],
  chin_up: ['lat_pulldown', 'pull_up', 'chest_supported_row'],
  lat_pulldown: ['chest_supported_row', 'seated_cable_row'],
  barbell_row: ['chest_supported_row', 'seated_cable_row', 'db_row'],
  db_row: ['chest_supported_row', 'seated_cable_row'],
  seated_cable_row: ['chest_supported_row', 'db_row'],
  chest_supported_row: ['seated_cable_row', 'db_row'],
  // legs
  back_squat: ['belt_squat', 'leg_press', 'safety_bar_squat', 'goblet_squat', 'leg_extension'],
  front_squat: ['belt_squat', 'leg_press', 'goblet_squat', 'leg_extension'],
  safety_bar_squat: ['belt_squat', 'leg_press', 'goblet_squat', 'leg_extension'],
  goblet_squat: ['belt_squat', 'leg_press', 'leg_extension'],
  belt_squat: ['leg_press', 'leg_extension'],
  leg_press: ['belt_squat', 'leg_extension', 'goblet_squat'],
  lunge: ['belt_squat', 'leg_press', 'leg_extension'],
  romanian_deadlift: ['leg_curl', 'cable_pull_through', 'hip_thrust'],
  leg_curl: ['romanian_deadlift', 'cable_pull_through'],
  hip_thrust: ['cable_pull_through'],
  cable_pull_through: ['hip_thrust', 'romanian_deadlift'],
  // shoulders
  overhead_press: ['landmine_press', 'db_shoulder_press', 'lateral_raise'],
  db_shoulder_press: ['landmine_press', 'lateral_raise'],
  landmine_press: ['db_shoulder_press'],
  // arms
  barbell_curl: ['hammer_curl', 'db_curl'],
  db_curl: ['hammer_curl'],
  hammer_curl: ['db_curl'],
  overhead_tricep_ext: ['tricep_pushdown'],
  // core
  crunch: ['plank'],
  hanging_leg_raise: ['plank', 'crunch'],
}
