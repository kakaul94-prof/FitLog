// Test data for the Android flows. Maestro runs this on the host (the CI
// runner or your PC), not on the emulator, so it reaches the local Supabase
// stack at 127.0.0.1. It signs in as the flows' own test account and goes
// through the same row-level security as the app, so it can only ever touch
// that account's rows. It refuses any URL that isn't the local stack.
//
// Called from a flow as
//   - runScript: { file: ../scripts/db.js, env: { ACTION: reset } }
// ACTION is one of:
//   reset        wipe the account's diary and weigh-ins; pick this run's
//                unique names (output.runId, output.weight)
//   cleanup      wipe them again (onFlowComplete: runs even after a failure)
//   food         NAME -> output.foodCount, output.servings (as saved)
//   weight       VALUE -> output.weightCount (weigh-ins with that value)
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

function rest(method, path) {
  var res = http.request(url + '/rest/v1/' + path, {
    method: method,
    headers: { apikey: anonKey, Authorization: 'Bearer ' + token },
  })
  if (!res.ok) throw new Error('db.js: ' + method + ' ' + path + ' failed (' + res.status + '): ' + res.body)
  return res.body ? json(res.body) : null
}

// The account belongs to these flows alone (supabase/seed.sql), so all of its
// diary entries and weigh-ins are test data. A filter is required for DELETE;
// RLS keeps it to this account's rows.
function wipe() {
  rest('DELETE', 'diary_entries?id=not.is.null')
  rest('DELETE', 'measurements?id=not.is.null')
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
} else if (action === 'food') {
  var name = required('NAME', typeof NAME === 'undefined' ? undefined : NAME)
  var rows = rest('GET', 'diary_entries?select=servings&food_name=eq.' + encodeURIComponent(name))
  output.foodCount = rows.length
  output.servings = rows.length ? Number(rows[0].servings) : null
} else if (action === 'weight') {
  var value = required('VALUE', typeof VALUE === 'undefined' ? undefined : VALUE)
  var weighIns = rest('GET', 'measurements?select=id&type=eq.weight&value=eq.' + encodeURIComponent(value))
  output.weightCount = weighIns.length
} else {
  throw new Error('db.js: unknown ACTION ' + action)
}
