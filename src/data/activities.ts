// Built-in cardio/activity library with MET values (Compendium of Physical
// Activities). Custom activities are stored per-user in the DB.
export interface BuiltinActivity {
  key: string
  name: string
  met: number
  distanceBased: boolean // walk/run/hike use distance-based kcal when available
}

export const ACTIVITIES: BuiltinActivity[] = [
  { key: 'walking_casual', name: 'Walking (casual, 3 mph)', met: 3.5, distanceBased: true },
  { key: 'walking_brisk', name: 'Walking (brisk, 4 mph)', met: 5.0, distanceBased: true },
  { key: 'jogging', name: 'Jogging (5 mph)', met: 8.3, distanceBased: true },
  { key: 'running', name: 'Running (6 mph)', met: 9.8, distanceBased: true },
  { key: 'running_fast', name: 'Running (7.5 mph)', met: 11.8, distanceBased: true },
  { key: 'hiking', name: 'Hiking', met: 6.0, distanceBased: true },
  { key: 'cycling_light', name: 'Cycling (light, 10–12 mph)', met: 6.8, distanceBased: false },
  { key: 'cycling_mod', name: 'Cycling (moderate, 12–14 mph)', met: 8.0, distanceBased: false },
  { key: 'swimming', name: 'Swimming (laps, moderate)', met: 5.8, distanceBased: false },
  { key: 'rowing', name: 'Rowing machine (moderate)', met: 7.0, distanceBased: false },
  { key: 'elliptical', name: 'Elliptical trainer', met: 5.0, distanceBased: false },
  { key: 'stair_climber', name: 'Stair climber', met: 9.0, distanceBased: false },
  { key: 'jump_rope', name: 'Jump rope', met: 11.0, distanceBased: false },
  { key: 'hiit', name: 'HIIT / circuit training', met: 8.0, distanceBased: false },
  { key: 'weight_training', name: 'Weight training (general)', met: 3.5, distanceBased: false },
  { key: 'yoga', name: 'Yoga', met: 2.5, distanceBased: false },
  { key: 'pilates', name: 'Pilates', met: 3.0, distanceBased: false },
  { key: 'soccer', name: 'Soccer', met: 7.0, distanceBased: false },
  { key: 'basketball', name: 'Basketball', met: 6.5, distanceBased: false },
  { key: 'tennis', name: 'Tennis', met: 7.3, distanceBased: false },
  { key: 'dancing', name: 'Dancing', met: 5.0, distanceBased: false },
]
