// Test data for the Android flows. Maestro runs this on the host (the CI
// runner or your PC), not on the emulator, so it reaches the local Supabase
// stack at 127.0.0.1. It signs in as the flows' own test account and goes
// through the same row-level security as the app, so it can only ever touch
// that account's rows. It refuses any URL that isn't the local stack.
//
// Called from a flow as
//   - runScript: { file: ../scripts/db.js, env: { ACTION: reset } }
// ACTION is one of:
//   reset        wipe the account's diary, weigh-ins and workouts; pick this
//                run's unique names (output.runId, output.weight)
//   cleanup      wipe them again (onFlowComplete: runs even after a failure)
//   seed-workout start today's workout: Bench Press, one set of 135 lb x 5
//   food         NAME -> output.foodCount, output.servings (as saved)
//   weight       VALUE -> output.weightCount (weigh-ins with that value)
//   workout      -> output.workoutCount, output.setCount, output.reps (of
//                the first set, as saved)
//
// Inputs come from MAESTRO_* environment variables (Maestro passes those
// through on its own): the stack's URL and anon key, and the test account.

function required(name, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(name + ' is not set (see .maestro/README.md)')
  }
  return value
}

var url = required('MAESTRO_SUPABASE_URL', typeof MAESTRO_SUPABASE_URL === 'undefined' ? undefined : MAESTRO_SUPABASE_URL)
var anonKey = required('MAESTRO_SUPABASE_ANON_KEY', typeof MAESTRO_SUPABASE_ANON_KEY === 'undefined' ? undefined : MAESTRO_SUPABASE_ANON_KEY)
var email = required('MAESTRO_FITLOG_EMAIL', typeof MAESTRO_FITLOG_EMAIL === 'undefined' ? undefined : MAESTRO_FITLOG_EMAIL)
var password = required('MAESTRO_FITLOG_PASSWORD', typeof MAESTRO_FITLOG_PASSWORD === 'undefined' ? undefined : MAESTRO_FITLOG_PASSWORD)
var action = required('ACTION', typeof ACTION === 'undefined' ? undefined : ACTION)

// These flows delete rows freely, so never let them near a hosted project.
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  throw new Error('MAESTRO_SUPABASE_URL must be the local Supabase stack, got ' + url)
}

function signIn() {
  var res = http.post(url + '/auth/v1/token?grant_type=password', {
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password }),
  })
  if (!res.ok) throw new Error('db.js: sign-in failed (' + res.status + '): ' + res.body)
  return json(res.body).access_token
}

var token = signIn()

// With a body, the request inserts it and returns the saved rows.
function rest(method, path, body) {
  var headers = { apikey: anonKey, Authorization: 'Bearer ' + token }
  var options = { method: method, headers: headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    headers.Prefer = 'return=representation'
    options.body = JSON.stringify(body)
  }
  var res = http.request(url + '/rest/v1/' + path, options)
  if (!res.ok) throw new Error('db.js: ' + method + ' ' + path + ' failed (' + res.status + '): ' + res.body)
  return res.body ? json(res.body) : null
}

// The account belongs to these flows alone (supabase/seed.sql), so all of its
// diary entries, weigh-ins and workouts are test data. A filter is required
// for DELETE; RLS keeps it to this account's rows. A workout's exercises and
// sets go with it (on delete cascade).
function wipe() {
  rest('DELETE', 'diary_entries?id=not.is.null')
  rest('DELETE', 'measurements?id=not.is.null')
  rest('DELETE', 'workouts?id=not.is.null')
}

function pad(n) {
  return (n < 10 ? '0' : '') + n
}

if (action === 'reset') {
  wipe()
  // Unique per flow run, so a rerun or a leftover row can never pass for this
  // run's data: base-36 time plus a random digit, e.g. "mh3k2x7".
  var runId = Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 10)
  output.runId = runId
  // A weigh-in no other run uses: 120.1 to 199.9 lb, never ending in .0
  // (the history list would show "150 lb", not "150.0 lb").
  var n = Date.now()
  output.weight = String(120 + (n % 80)) + '.' + String(1 + (Math.floor(n / 80) % 9))
} else if (action === 'cleanup') {
  wipe()
} else if (action === 'seed-workout') {
  // In progress and dated today, so the Exercise tab offers "Continue
  // workout". Today is this machine's date: the emulator takes its time zone
  // from the host, and the app dates workouts by the phone's.
  var d = new Date()
  var today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  var workout = rest('POST', 'workouts', { workout_date: today, completed: false })[0]
  var exercise = rest('POST', 'workout_exercises', {
    workout_id: workout.id,
    exercise_key: 'bench_press',
    exercise_name: 'Bench Press',
    position: 0,
  })[0]
  rest('POST', 'workout_sets', {
    workout_id: workout.id,
    workout_exercise_id: exercise.id,
    exercise_key: 'bench_press',
    exercise_name: 'Bench Press',
    set_number: 1,
    weight_lb: 135,
    reps: 5,
  })
} else if (action === 'food') {
  var name = required('NAME', typeof NAME === 'undefined' ? undefined : NAME)
  var rows = rest('GET', 'diary_entries?select=servings&food_name=eq.' + encodeURIComponent(name))
  output.foodCount = rows.length
  output.servings = rows.length ? Number(rows[0].servings) : null
} else if (action === 'weight') {
  var value = required('VALUE', typeof VALUE === 'undefined' ? undefined : VALUE)
  var weighIns = rest('GET', 'measurements?select=id&type=eq.weight&value=eq.' + encodeURIComponent(value))
  output.weightCount = weighIns.length
} else if (action === 'workout') {
  var workouts = rest('GET', 'workouts?select=id')
  var sets = rest('GET', 'workout_sets?select=reps&order=set_number')
  output.workoutCount = workouts.length
  output.setCount = sets.length
  output.reps = sets.length ? Number(sets[0].reps) : null
} else {
  throw new Error('db.js: unknown ACTION ' + action)
}
