// One-off: import workoutlog.csv (Strength section) into FitLog.
//   node scripts/import-workouts.mjs --dry-run                 parse + report, write nothing
//   node scripts/import-workouts.mjs                           live import (idempotent: skips dates that already have a workout)
//   node scripts/import-workouts.mjs --overwrite               delete + re-import any date present in the CSV
//   node scripts/import-workouts.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD   limit to a date window (inclusive)
//
// Signs in as you (FITLOG_EMAIL/PASSWORD in .env) so rows land in your account via RLS.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry-run')
const OVERWRITE = process.argv.includes('--overwrite')
const arg = (k) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.split('=').slice(1).join('=') : undefined }
const FROM = arg('from')
const TO = arg('to')
const CSV_PATH = new URL('../workoutlog.csv', import.meta.url)

// ---- env ----
function env() {
  const txt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const get = (k) => (txt.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm')) || [])[1]?.trim()
  return {
    url: get('VITE_SUPABASE_URL'),
    anon: get('VITE_SUPABASE_ANON_KEY'),
    email: get('FITLOG_EMAIL'),
    password: get('FITLOG_PASSWORD'),
  }
}

// ---- RFC-4180 CSV tokenizer (handles quoted fields w/ embedded commas, quotes, newlines) ----
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

function toISO(d) {
  const m = (d || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const yr = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const timeMin = (t) => {
  const m = (t || '').match(/(\d{1,2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : 0
}
const muscleOf = (name) => (name.match(/\(([^)]*)\)\s*$/) || [])[1]?.trim() || null

// Resolve a CSV name to a built-in lift key (so common lifts aren't stored as
// customs, and the app's Form tab can show built-in cues). Only unambiguous
// equivalents. Keep in sync with src/data/exerciseAliases.ts.
const normName = (s) =>
  (s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
const BUILTIN_ALIASES = {
  'bench press': 'bench_press', 'dumbbell bench press': 'db_bench_press',
  'inclined bench press': 'incline_bench_press', 'cable flys': 'chest_fly', 'push ups': 'push_up',
  deadlift: 'deadlift', 'pull ups': 'pull_up', 'chin up': 'chin_up', 'lat pull down': 'lat_pulldown',
  'bent over rows': 'barbell_row', 'one arm dumbbell rows': 'db_row', 'seated row': 'seated_cable_row',
  'face pulls': 'face_pull', squat: 'back_squat', 'front squat': 'front_squat', 'leg press': 'leg_press',
  'dumbbell walking lunges': 'lunge', 'dumbbell romanian deadlift': 'romanian_deadlift',
  'barbell romanian deadlifts': 'romanian_deadlift', 'leg curl': 'leg_curl', 'leg extension': 'leg_extension',
  'standing calf': 'calf_raise', 'hip thrusts': 'hip_thrust', 'overhead press': 'overhead_press',
  'dumbbell overhead press': 'db_shoulder_press', 'seated dumbbell press': 'db_shoulder_press',
  'lateral raise': 'lateral_raise', 'alternating dumbbell bicep curl': 'db_curl', 'hammer curl': 'hammer_curl',
  'cable pull down': 'tricep_pushdown', 'overhead tricep extension': 'overhead_tricep_ext',
  dips: 'dip', planks: 'plank', 'bicep curls': 'barbell_curl', 'low row': 'seated_cable_row',
  'seated dip': 'dip', 'seated dips': 'dip',
}
const builtinKey = (name) => BUILTIN_ALIASES[normName(name)]

// ---- read + parse the Strength block ----
const raw = fs.readFileSync(CSV_PATH, 'utf8')
const sIdx = raw.indexOf('-----Strength-----')
if (sIdx < 0) throw new Error('no -----Strength----- marker found')
let block = raw.slice(sIdx + '-----Strength-----'.length)
const nextMarker = block.indexOf('\n-----')
if (nextMarker >= 0) block = block.slice(0, nextMarker)

const records = parseCSV(block).filter((r) => r[0] !== 'Date') // drop header
// record = [Date, Time, Exercise, # of Reps, Weight, Notes?]

// ---- group: date -> ordered exercise instances -> sets ----
const byDate = new Map()
let seen = 0
for (const r of records) {
  const iso = toISO(r[0])
  const name = (r[2] || '').trim()
  if (!iso || !name) continue
  seen++
  if (!byDate.has(iso)) byDate.set(iso, new Map())
  const groups = byDate.get(iso)
  const gkey = `${r[1]}||${name}`
  if (!groups.has(gkey)) groups.set(gkey, { time: timeMin(r[1]), order: groups.size, name, notes: [], sets: [] })
  const g = groups.get(gkey)
  g.sets.push({ reps: num(r[3]), weight_lb: num(r[4]) })
  const note = (r[5] || '').trim()
  if (note && !g.notes.includes(note)) g.notes.push(note)
}

// flatten to ordered structure, applying optional --from/--to window (inclusive)
const inRange = (iso) => (!FROM || iso >= FROM) && (!TO || iso <= TO)
const allDates = [...byDate.keys()].sort()
const dates = allDates.filter(inRange)
const model = dates.map((iso) => {
  const groups = [...byDate.get(iso).values()].sort((a, b) => a.time - b.time || a.order - b.order)
  return { iso, exercises: groups }
})
// distinct exercises scoped to the window, so we only create customs that are actually used
const distinctNames = [...new Set(model.flatMap((d) => d.exercises.map((e) => e.name)))]
const totalSets = model.reduce((s, d) => s + d.exercises.reduce((x, e) => x + e.sets.length, 0), 0)

const rangeNote = FROM || TO ? ` [window ${FROM || '…'} → ${TO || '…'} of ${allDates.length} total dates]` : ''
console.log(`Parsed ${seen} sets total; importing ${dates.length} dates, ${distinctNames.length} distinct exercises, ${totalSets} sets${rangeNote}`)

// ---- connect ----
const { url, anon, email, password } = env()
if (!url || !anon || !email || !password)
  throw new Error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / FITLOG_EMAIL / FITLOG_PASSWORD in .env')
const sb = createClient(url, anon, { auth: { persistSession: false } })
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password })
if (authErr) throw authErr
console.log(`Signed in as ${auth.user.email}`)

// ---- existing workout dates (idempotency) ----
const { data: existing, error: exErr } = await sb.from('workouts').select('workout_date')
if (exErr) throw exErr
const existingDates = new Set((existing ?? []).map((w) => w.workout_date))
const skip = OVERWRITE ? new Set() : existingDates
const toImport = model.filter((d) => !skip.has(d.iso))
const skipped = model.length - toImport.length
const overlapDates = OVERWRITE ? model.filter((d) => existingDates.has(d.iso)).map((d) => d.iso) : []

console.log(`${toImport.length} dates to import, ${skipped} skipped (already present)${OVERWRITE ? `, ${overlapDates.length} will be overwritten` : ''}`)

// ---- existing custom exercises -> name->key map ----
const { data: customs, error: cErr } = await sb.from('custom_exercises').select('id,name')
if (cErr) throw cErr
const keyByName = new Map((customs ?? []).map((c) => [c.name, `custom:${c.id}`]))
// Built-in lifts resolve by name and are NOT created as customs.
const resolveKey = (name) => builtinKey(name) ?? keyByName.get(name)
const newNames = distinctNames.filter((n) => !builtinKey(n) && !keyByName.has(n))
console.log(`${distinctNames.filter((n) => builtinKey(n)).length} of ${distinctNames.length} distinct names matched to built-in lifts`)

const setsToImport = toImport.reduce((s, d) => s + d.exercises.reduce((x, e) => x + e.sets.length, 0), 0)
const exToImport = toImport.reduce((s, d) => s + d.exercises.length, 0)

if (DRY) {
  console.log('\n--- DRY RUN (nothing written) ---')
  console.log(`Custom exercises to create: ${newNames.length} (already exist: ${distinctNames.length - newNames.length})`)
  console.log(`Workouts: ${toImport.length} | exercise instances: ${exToImport} | sets: ${setsToImport}`)
  console.log('\nSample new exercises:', newNames.slice(0, 8).map((n) => `${n} [${muscleOf(n) || '—'}]`).join(' | '))
  const s = model.find((d) => d.exercises.length)
  if (s) {
    console.log(`\nSample date ${s.iso}:`)
    for (const e of s.exercises.slice(0, 4))
      console.log(`  ${e.name} — ${e.sets.map((x) => `${x.reps ?? '?'}x${x.weight_lb ?? '?'}`).join(', ')}${e.notes.length ? `  // ${e.notes.join(' ; ').slice(0, 60)}` : ''}`)
  }
  process.exit(0)
}

// ---- chunked insert helper ----
async function insertChunked(table, rows, select) {
  const out = []
  for (let i = 0; i < rows.length; i += 500) {
    let q = sb.from(table).insert(rows.slice(i, i + 500))
    if (select) q = q.select(select)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (select) out.push(...(data ?? []))
  }
  return out
}

// ---- 1. create missing custom exercises ----
if (newNames.length) {
  const rows = newNames.map((n) => ({ name: n, muscle: muscleOf(n), type: 'weighted' }))
  const created = await insertChunked('custom_exercises', rows, 'id,name')
  for (const c of created) keyByName.set(c.name, `custom:${c.id}`)
  console.log(`Created ${created.length} custom exercises`)
}

// ---- 2. overwrite: delete colliding dates (cascade removes exercises + sets) ----
if (OVERWRITE && overlapDates.length) {
  for (let i = 0; i < overlapDates.length; i += 200) {
    const { error } = await sb.from('workouts').delete().in('workout_date', overlapDates.slice(i, i + 200))
    if (error) throw error
  }
  console.log(`Deleted ${overlapDates.length} existing workouts (overwrite)`)
}

// ---- 3. insert workouts -> date->id ----
const wRows = toImport.map((d) => ({ workout_date: d.iso }))
const wCreated = await insertChunked('workouts', wRows, 'id,workout_date')
const widByDate = new Map(wCreated.map((w) => [w.workout_date, w.id]))
console.log(`Inserted ${wCreated.length} workouts`)

// ---- 4. insert workout_exercises -> (workout_id,position)->id ----
const exRows = []
for (const d of toImport) {
  const wid = widByDate.get(d.iso)
  d.exercises.forEach((e, position) => {
    exRows.push({
      workout_id: wid,
      exercise_key: resolveKey(e.name),
      exercise_name: e.name,
      position,
      notes: e.notes.length ? e.notes.join('\n') : null,
    })
  })
}
const exCreated = await insertChunked('workout_exercises', exRows, 'id,workout_id,position')
const exId = new Map(exCreated.map((x) => [`${x.workout_id}|${x.position}`, x.id]))
console.log(`Inserted ${exCreated.length} exercise instances`)

// ---- 5. insert workout_sets ----
const setRows = []
for (const d of toImport) {
  const wid = widByDate.get(d.iso)
  d.exercises.forEach((e, position) => {
    const weid = exId.get(`${wid}|${position}`)
    e.sets.forEach((s, i) => {
      setRows.push({
        workout_id: wid,
        workout_exercise_id: weid,
        exercise_key: resolveKey(e.name),
        exercise_name: e.name,
        set_number: i + 1,
        reps: s.reps,
        weight_lb: s.weight_lb,
      })
    })
  })
}
await insertChunked('workout_sets', setRows)
console.log(`Inserted ${setRows.length} sets`)
console.log('\n✅ Done.')
