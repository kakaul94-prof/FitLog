// Built-in cardio/activity library with MET values (Compendium of Physical
// Activities). Custom activities are stored per-user in the DB.
export interface BuiltinActivity {
  key: string
  name: string
  met: number
  distanceBased: boolean // walk/run/hike use distance-based kcal when available
}

export const ACTIVITIES: BuiltinActivity[] = [
  // The pure walk/run entries moved to RECORDER_ACTIVITIES — log those via the
  // GPS walk/run recorder. Treadmill/indoor variants stay here because GPS
  // can't measure a walk/run you do without moving through space.
  { key: 'walking_treadmill', name: 'Walking (treadmill)', met: 4.3, distanceBased: true },
  { key: 'running_treadmill', name: 'Running (treadmill)', met: 9.8, distanceBased: true },
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

  // Household & yard work
  { key: 'mowing_push', name: 'Mowing lawn (push mower)', met: 5.5, distanceBased: false },
  { key: 'mowing_riding', name: 'Mowing lawn (riding mower)', met: 2.5, distanceBased: false },
  { key: 'gardening', name: 'Gardening (general)', met: 3.8, distanceBased: false },
  { key: 'raking', name: 'Raking leaves', met: 3.8, distanceBased: false },
  { key: 'shoveling_snow', name: 'Shoveling snow (by hand)', met: 5.3, distanceBased: false },
  { key: 'vacuuming', name: 'Vacuuming', met: 3.3, distanceBased: false },
  { key: 'cleaning', name: 'House cleaning (general)', met: 3.3, distanceBased: false },
  { key: 'mopping', name: 'Mopping / sweeping', met: 3.5, distanceBased: false },
  { key: 'washing_car', name: 'Washing the car', met: 3.0, distanceBased: false },
  { key: 'moving_furniture', name: 'Moving furniture / boxes', met: 5.8, distanceBased: false },
  { key: 'painting_home', name: 'Home repair / painting', met: 3.3, distanceBased: false },
  { key: 'childcare', name: 'Childcare (active)', met: 3.5, distanceBased: false },
  { key: 'dog_walking', name: 'Walking the dog', met: 3.0, distanceBased: true },

  // Recreation & sport
  { key: 'rucking', name: 'Rucking (walking w/ load)', met: 7.0, distanceBased: true },
  { key: 'table_tennis', name: 'Table tennis (ping pong)', met: 4.0, distanceBased: false },
  { key: 'pickleball', name: 'Pickleball', met: 4.5, distanceBased: false },
  { key: 'badminton', name: 'Badminton (social)', met: 4.5, distanceBased: false },
  { key: 'volleyball', name: 'Volleyball (recreational)', met: 4.0, distanceBased: false },
  { key: 'golf_walking', name: 'Golf (walking, carrying clubs)', met: 4.3, distanceBased: false },
  { key: 'bowling', name: 'Bowling', met: 3.8, distanceBased: false },
  { key: 'skating', name: 'Skating / rollerblading', met: 7.0, distanceBased: false },
  { key: 'skiing_downhill', name: 'Skiing (downhill)', met: 5.3, distanceBased: false },
  { key: 'martial_arts', name: 'Martial arts', met: 10.0, distanceBased: false },
  { key: 'boxing', name: 'Boxing (heavy bag)', met: 6.0, distanceBased: false },
  { key: 'rock_climbing', name: 'Rock climbing / bouldering', met: 8.0, distanceBased: false },
]

// Activities offered by the GPS walk/run recorder (ExerciseTrackPage). Kept
// separate from ACTIVITIES so they don't clutter the manual picker — you record
// these, you don't hand-pick them. Calories are pace-aware at log time, so the
// MET here only sets the entry's stored MET + the label-based fallback estimate.
export const RECORDER_ACTIVITIES: BuiltinActivity[] = [
  { key: 'walking', name: 'Walking', met: 4.3, distanceBased: true },
  { key: 'running', name: 'Running', met: 9.8, distanceBased: true },
  { key: 'jogging', name: 'Jogging', met: 8.3, distanceBased: true },
  { key: 'hiking', name: 'Hiking', met: 6.0, distanceBased: true },
]
