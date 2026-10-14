// Every request the journeys make, by name, with its endpoint group.
//
// The name becomes the request's `name` tag (k6 would otherwise tag by URL, and
// the ids in query strings would make every request its own metric), and the
// group picks its latency budget in config/thresholds.ts. The request builder
// refuses a name that isn't listed, so adding an endpoint is one line here and
// its budget, per-endpoint threshold and dashboard row follow automatically.
export type Op = 'search' | 'read' | 'write' | 'auth' | 'signin' | 'fn'

export const ENDPOINTS = {
  // Diary tab (DiaryPage: five queries fire together on open)
  'diary.day': 'read',
  'exercise.day': 'read',
  'profile.get': 'read',
  'weight.latest': 'read',
  'diary.streak': 'read',
  // Food picker (FoodPickerPage)
  'foods.history': 'read',
  'foods.list': 'read',
  'meals.list': 'read',
  'foods.search': 'search',
  'diary.insert': 'write',
  // Lift tab (useStrength)
  'workouts.list': 'read',
  'workouts.insert': 'write',
  'workoutEx.list': 'read',
  'workoutEx.insert': 'write',
  'sets.prior': 'read',
  'goal.get': 'read',
  'sets.insert': 'write',
  'sets.update': 'write',
  'workouts.update': 'write',
  'workout.get': 'read',
  'sets.list': 'read',
  // Weight (useMeasurements)
  'measurements.list': 'read',
  'measurements.insert': 'write',
  // Auth and Pages Functions
  'auth.signin': 'signin', // bcrypt-bound by design; reported, not budgeted
  'auth.refresh': 'auth',
  'fn.trainer': 'fn',
} as const satisfies Record<string, Op>

export type EndpointName = keyof typeof ENDPOINTS
export const ENDPOINT_NAMES = Object.keys(ENDPOINTS) as EndpointName[]
