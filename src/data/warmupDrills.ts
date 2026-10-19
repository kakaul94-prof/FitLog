// Warm-up drills for a template's Warm-up block. Dynamic on purpose: long
// static holds right before lifting can blunt force output, so the stretch
// library (kind 'mobility' in exercises.ts) is not offered here. Each drill
// is ticked off, not logged — `estSec` is what a tick banks to the Mobility
// list; `holdSec` drills get a countdown that banks the real time instead.

/** Joint areas a drill prepares; lifts map onto the same tags (lib/warmup.ts). */
export type WarmupTag =
  | 'ankle'
  | 'hip'
  | 'hamstring'
  | 'tspine'
  | 'shoulder'
  | 'scap'
  | 'wrist'
  | 'core'

export interface WarmupDrill {
  key: string
  name: string
  /** Prescription shown on the row, e.g. "10 / side". */
  dose: string
  /** Estimated time, banked to Mobility when ticked. */
  estSec: number
  /** Timed hold: the row gets a countdown from here. */
  holdSec?: number
  tags: WarmupTag[]
}

export const WARMUP_DRILLS: WarmupDrill[] = [
  { key: 'worlds_greatest', name: "World's greatest stretch", dose: '3 / side', estSec: 120, tags: ['hip', 'tspine', 'hamstring'] },
  { key: 'ankle_rocks', name: 'Ankle rocks', dose: '10 / side', estSec: 60, tags: ['ankle'] },
  { key: 'goblet_squat_pry', name: 'Goblet squat pry', dose: '30 s', estSec: 30, holdSec: 30, tags: ['ankle', 'hip'] },
  { key: 'leg_swings', name: 'Leg swings', dose: '10 / side', estSec: 60, tags: ['hip', 'hamstring'] },
  { key: 'hip_switch', name: '90/90 hip switch', dose: '6 / side', estSec: 60, tags: ['hip'] },
  { key: 'hip_circles', name: 'Hip circles', dose: '8 / side', estSec: 60, tags: ['hip'] },
  { key: 'glute_bridge', name: 'Glute bridge', dose: '10', estSec: 45, tags: ['hip'] },
  { key: 'bw_good_morning', name: 'Bodyweight good morning', dose: '10', estSec: 45, tags: ['hamstring'] },
  { key: 'band_pull_apart', name: 'Band pull-apart', dose: '15', estSec: 45, tags: ['scap', 'shoulder'] },
  { key: 'scap_push_up', name: 'Scap push-up', dose: '10', estSec: 45, tags: ['scap', 'shoulder'] },
  { key: 'band_dislocates', name: 'Band dislocates', dose: '10', estSec: 45, tags: ['shoulder', 'tspine'] },
  { key: 'wall_slides', name: 'Wall slides', dose: '10', estSec: 45, tags: ['shoulder', 'scap'] },
  { key: 'arm_circles', name: 'Arm circles', dose: '10 each way', estSec: 45, tags: ['shoulder'] },
  { key: 'dead_hang', name: 'Dead hang', dose: '30 s', estSec: 30, holdSec: 30, tags: ['scap', 'shoulder'] },
  { key: 'open_book', name: 'Open book rotation', dose: '6 / side', estSec: 60, tags: ['tspine'] },
  { key: 'cat_cow', name: 'Cat-cow', dose: '8', estSec: 45, tags: ['tspine', 'core'] },
  { key: 'dead_bug', name: 'Dead bug', dose: '6 / side', estSec: 60, tags: ['core'] },
  { key: 'wrist_circles', name: 'Wrist circles', dose: '10 each way', estSec: 30, tags: ['wrist'] },
]

export const findWarmupDrill = (key: string): WarmupDrill | undefined =>
  WARMUP_DRILLS.find((d) => d.key === key)
