// Rehab movement library + starter protocols, keyed to the pain sites in
// lib/rehab.ts.
//
// Deliberately NOT part of data/exercises.ts: everything in EXERCISES is
// selectable inside a workout, which would feed band work into the volume
// heatmap and muscle targets. Rehab keeps its own list and its own log.
//
// These are general strengthening and mobility movements, not treatment for any
// diagnosis. The app says so on every rehab screen.

export type RehabKind = 'reps' | 'hold'

export interface RehabExercise {
  key: string
  name: string
  /** Pain sites this belongs to (PAIN_SITES values). */
  sites: string[]
  kind: RehabKind
  /** Suggested per-sitting hold, seconds. Holds only. */
  holdSec?: number
  /** One-line "what good looks like". */
  cue?: string
}

export const REHAB_EXERCISES: RehabExercise[] = [
  // Shoulder
  { key: 'rehab_band_er', name: 'Banded external rotation', sites: ['shoulder'], kind: 'reps', cue: 'Elbow pinned to your side, rotate from the shoulder not the wrist.' },
  { key: 'rehab_band_ir', name: 'Banded internal rotation', sites: ['shoulder'], kind: 'reps', cue: 'Same elbow position, pulling across the body.' },
  { key: 'rehab_sidelying_er', name: 'Side-lying external rotation', sites: ['shoulder'], kind: 'reps', cue: 'Light dumbbell, towel under the elbow, slow lower.' },
  { key: 'rehab_iso_er', name: 'Isometric external rotation hold', sites: ['shoulder'], kind: 'hold', holdSec: 30, cue: 'Press into a doorframe at a load that does not provoke pain.' },
  { key: 'rehab_scap_wall_slide', name: 'Scapular wall slide', sites: ['shoulder'], kind: 'reps', cue: 'Forearms on the wall, slide up without shrugging or arching.' },
  { key: 'rehab_prone_y', name: 'Prone Y raise', sites: ['shoulder'], kind: 'reps', cue: 'Thumbs up, lift from the lower traps, no weight needed at first.' },
  { key: 'rehab_prone_t', name: 'Prone T raise', sites: ['shoulder'], kind: 'reps', cue: 'Squeeze the shoulder blades together, arms straight out.' },
  { key: 'rehab_serratus_press', name: 'Serratus wall press', sites: ['shoulder'], kind: 'reps', cue: 'Arms straight, push the wall away so the blades spread.' },
  { key: 'rehab_scap_pullup', name: 'Scapular pull-up', sites: ['shoulder'], kind: 'reps', cue: 'Hang, then pull the shoulders down without bending the elbows.' },
  { key: 'rehab_doorway_pec', name: 'Doorway pec stretch', sites: ['shoulder'], kind: 'hold', holdSec: 30, cue: 'Forearm on the frame at 90°, step through until you feel the chest.' },
  { key: 'rehab_sleeper_stretch', name: 'Sleeper stretch', sites: ['shoulder'], kind: 'hold', holdSec: 30, cue: 'Side-lying, gently rotate the forearm down. Stretch, never pain.' },

  // Elbow
  { key: 'rehab_wrist_ext_ecc', name: 'Wrist extensor eccentric', sites: ['elbow', 'wrist'], kind: 'reps', cue: 'Lift with the other hand, lower slowly over 3 seconds.' },
  { key: 'rehab_wrist_flex_ecc', name: 'Wrist flexor eccentric', sites: ['elbow', 'wrist'], kind: 'reps', cue: 'Same, palm up.' },
  { key: 'rehab_tyler_twist', name: 'Tyler twist', sites: ['elbow'], kind: 'reps', cue: 'Flex bar, twist and release under control.' },
  { key: 'rehab_supination', name: 'Hammer supination', sites: ['elbow', 'wrist'], kind: 'reps', cue: 'Hold a hammer near the head, rotate palm up and down.' },

  // Wrist
  { key: 'rehab_wrist_flex_stretch', name: 'Wrist flexor stretch', sites: ['wrist'], kind: 'hold', holdSec: 30 },
  { key: 'rehab_wrist_ext_stretch', name: 'Wrist extensor stretch', sites: ['wrist'], kind: 'hold', holdSec: 30 },
  { key: 'rehab_grip_squeeze', name: 'Grip squeeze', sites: ['wrist', 'elbow'], kind: 'hold', holdSec: 20, cue: 'Squeeze a ball or towel at a load that stays comfortable.' },

  // Low back
  { key: 'rehab_mcgill_curlup', name: 'McGill curl-up', sites: ['low back'], kind: 'hold', holdSec: 10, cue: 'Hands under the low back, one knee bent, lift head and shoulders barely off the floor.' },
  { key: 'rehab_side_plank', name: 'Side plank', sites: ['low back'], kind: 'hold', holdSec: 20, cue: 'From the knees first; stack the hips and do not let them sag.' },
  { key: 'rehab_bird_dog', name: 'Bird dog', sites: ['low back'], kind: 'hold', holdSec: 10, cue: 'Opposite arm and leg, hips level — a glass of water should stay on your back.' },
  { key: 'rehab_dead_bug', name: 'Dead bug', sites: ['low back'], kind: 'reps', cue: 'Low back flat to the floor the whole time.' },
  { key: 'rehab_glute_bridge', name: 'Glute bridge', sites: ['low back', 'hip', 'knee'], kind: 'reps', cue: 'Drive through the heels, ribs down, squeeze at the top.' },
  { key: 'rehab_cat_cow', name: 'Cat-cow', sites: ['low back'], kind: 'reps', cue: 'Slow, through the whole spine.' },

  // Hip
  { key: 'rehab_clamshell', name: 'Clamshell', sites: ['hip'], kind: 'reps', cue: 'Side-lying, heels together, do not roll the top hip back.' },
  { key: 'rehab_hip_abduction', name: 'Side-lying hip abduction', sites: ['hip'], kind: 'reps', cue: 'Leg slightly behind the body, toe pointed forward.' },
  { key: 'rehab_monster_walk', name: 'Banded monster walk', sites: ['hip', 'knee'], kind: 'reps', cue: 'Band above the knees, small athletic stance, stay low.' },
  { key: 'rehab_ninety_ninety', name: '90/90 hip switch', sites: ['hip'], kind: 'reps', cue: 'Rotate knee to knee under control, chest tall.' },
  { key: 'rehab_couch_stretch', name: 'Couch stretch', sites: ['hip'], kind: 'hold', holdSec: 60, cue: 'Tuck the pelvis before you lean back, or you just stretch the low back.' },

  // Knee
  { key: 'rehab_spanish_squat', name: 'Spanish squat hold', sites: ['knee'], kind: 'hold', holdSec: 30, cue: 'Band behind the knees, shins vertical, sit back into it.' },
  { key: 'rehab_wall_sit', name: 'Wall sit', sites: ['knee'], kind: 'hold', holdSec: 45, cue: 'Find the depth that stays pain-free, hold there.' },
  { key: 'rehab_tke', name: 'Terminal knee extension', sites: ['knee'], kind: 'reps', cue: 'Band pulling the knee forward, straighten fully and squeeze the quad.' },
  { key: 'rehab_step_down', name: 'Step-down', sites: ['knee'], kind: 'reps', cue: 'Slow lower, knee tracking over the middle toes, no collapsing in.' },
  { key: 'rehab_sl_calf_raise', name: 'Single-leg calf raise', sites: ['knee'], kind: 'reps', cue: 'Full range, pause at the top, slow down.' },
  { key: 'rehab_straight_leg_raise', name: 'Straight-leg raise', sites: ['knee'], kind: 'reps', cue: 'Lock the knee before you lift, lower slowly.' },
]

export interface RehabProtocol {
  id: string
  name: string
  site: string
  /** What it's for, in one line. */
  blurb: string
  items: { key: string; targetPerWeek: number }[]
}

/** Starter bundles. Attaching one copies its exercises into the injury's plan,
 *  where they can be retargeted or removed like any other row. */
export const REHAB_PROTOCOLS: RehabProtocol[] = [
  {
    id: 'shoulder_cuff',
    name: 'Rotator cuff basics',
    site: 'shoulder',
    blurb: 'Light external rotation work plus scapular control.',
    items: [
      { key: 'rehab_sidelying_er', targetPerWeek: 4 },
      { key: 'rehab_band_er', targetPerWeek: 4 },
      { key: 'rehab_prone_y', targetPerWeek: 3 },
      { key: 'rehab_scap_wall_slide', targetPerWeek: 3 },
    ],
  },
  {
    id: 'shoulder_scap',
    name: 'Scapular control',
    site: 'shoulder',
    blurb: 'For blades that wing or shrug under load.',
    items: [
      { key: 'rehab_prone_y', targetPerWeek: 3 },
      { key: 'rehab_prone_t', targetPerWeek: 3 },
      { key: 'rehab_serratus_press', targetPerWeek: 3 },
      { key: 'rehab_scap_pullup', targetPerWeek: 3 },
    ],
  },
  {
    id: 'shoulder_overhead',
    name: 'Overhead prep',
    site: 'shoulder',
    blurb: 'Open the front, then groove the overhead position.',
    items: [
      { key: 'rehab_doorway_pec', targetPerWeek: 5 },
      { key: 'rehab_scap_wall_slide', targetPerWeek: 4 },
      { key: 'rehab_iso_er', targetPerWeek: 3 },
    ],
  },
  {
    id: 'elbow_tendon',
    name: 'Tendon loading',
    site: 'elbow',
    blurb: 'Slow eccentrics and grip work for a cranky elbow.',
    items: [
      { key: 'rehab_wrist_ext_ecc', targetPerWeek: 5 },
      { key: 'rehab_tyler_twist', targetPerWeek: 4 },
      { key: 'rehab_grip_squeeze', targetPerWeek: 4 },
    ],
  },
  {
    id: 'back_big3',
    name: 'McGill big 3',
    site: 'low back',
    blurb: 'The standard endurance trio for the trunk.',
    items: [
      { key: 'rehab_mcgill_curlup', targetPerWeek: 5 },
      { key: 'rehab_side_plank', targetPerWeek: 5 },
      { key: 'rehab_bird_dog', targetPerWeek: 5 },
    ],
  },
  {
    id: 'hip_glute',
    name: 'Glute activation',
    site: 'hip',
    blurb: 'Wake up the lateral hip before it asks the low back for help.',
    items: [
      { key: 'rehab_clamshell', targetPerWeek: 4 },
      { key: 'rehab_hip_abduction', targetPerWeek: 4 },
      { key: 'rehab_glute_bridge', targetPerWeek: 3 },
      { key: 'rehab_monster_walk', targetPerWeek: 3 },
    ],
  },
  {
    id: 'knee_iso',
    name: 'Patellar tendon isometrics',
    site: 'knee',
    blurb: 'Heavy-ish holds, which often calm tendon pain same-session.',
    items: [
      { key: 'rehab_spanish_squat', targetPerWeek: 5 },
      { key: 'rehab_wall_sit', targetPerWeek: 4 },
      { key: 'rehab_tke', targetPerWeek: 3 },
    ],
  },
  {
    id: 'knee_strength',
    name: 'Knee general strength',
    site: 'knee',
    blurb: 'Quad, glute and calf work around the joint.',
    items: [
      { key: 'rehab_step_down', targetPerWeek: 3 },
      { key: 'rehab_sl_calf_raise', targetPerWeek: 3 },
      { key: 'rehab_glute_bridge', targetPerWeek: 3 },
      { key: 'rehab_straight_leg_raise', targetPerWeek: 3 },
    ],
  },
]

export const rehabByKey = new Map(REHAB_EXERCISES.map((e) => [e.key, e]))

/** Library for a site, that site's own movements first. */
export function rehabForSite(site: string): RehabExercise[] {
  const mine = REHAB_EXERCISES.filter((e) => e.sites[0] === site)
  const shared = REHAB_EXERCISES.filter(
    (e) => e.sites[0] !== site && e.sites.includes(site),
  )
  return [...mine, ...shared]
}

export const protocolsForSite = (site: string) =>
  REHAB_PROTOCOLS.filter((p) => p.site === site)
