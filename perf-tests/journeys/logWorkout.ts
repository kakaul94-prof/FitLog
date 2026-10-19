// Log a workout: open the Lift tab, start a session, add two lifts (each: where
// it goes, what you did last time, any goal, then last time's set count as
// blank rows), fill in each set between rests, mark the workout done and look
// at it. The rest between sets is compressed (8–15 s rather than 90) so one
// journey takes about a minute; the request shape is the app's own
// (useStrength.ts: useCreateWorkout, useAddExercise, useUpdateSet, useWorkout).
import { expectRow, expectRows, expectStatus } from '../lib/checks.ts'
import { between, pick, uuid } from '../lib/ids.ts'
import { batch, rest, type Query } from '../lib/rest.ts'
import { LIFTS } from '../lib/seed.ts'
import { think } from '../lib/think.ts'
import type { Ctx } from '../lib/users.ts'

interface SetRow {
  id: string
  workout_exercise_id: string
  set_number: number
}

type Rest = { from: (table: string) => Query }

/** The workout page: workout, its exercises and its sets, together. */
function readWorkout(r: Rest, workoutId: string): SetRow[] {
  const [workout, exercises, sets] = batch([
    r.from('workouts').select('*').eq('id', workoutId).prepare('GET', 'workout.get'),
    r.from('workout_exercises').select('*').eq('workout_id', workoutId).order('position').prepare('GET', 'workoutEx.list'),
    r.from('workout_sets').select('*').eq('workout_id', workoutId).order('set_number').prepare('GET', 'sets.list'),
  ])
  expectRows(workout, 'workout.get', 1)
  expectStatus(exercises, 'workoutEx.list')
  return expectRows<SetRow>(sets, 'sets.list')
}

export function logWorkout(ctx: Ctx): void {
  const r = rest(ctx.caller)
  expectRows(r.from('workouts').select('*').order('workout_date', { ascending: false }).order('created_at', { ascending: false }).limit(50).get('workouts.list'), 'workouts.list', 1)
  think(2, 4)

  // useCreateWorkout → insertOnce: the client picks the id, insert + select single.
  const workoutId = uuid()
  const created = expectRow<{ id: string }>(
    r.from('workouts').select('*').single().insert({ id: workoutId, workout_date: ctx.today, name: pick(['Push', 'Pull', 'Legs']), source_routine_id: null }, 'workouts.insert', 'representation'),
    'workouts.insert',
    201,
  )
  if (!created) return

  const start = between(0, LIFTS.length - 1)
  for (let p = 0; p < 2; p++) {
    const [key, name, base] = LIFTS[(start + p) % LIFTS.length]
    think(1, 2) // picking the exercise

    // useAddExercise: the position, then the new row, then last time + goal.
    const existing = expectRows<{ id: string }>(r.from('workout_exercises').select('id,position,superset_group').eq('workout_id', workoutId).get('workoutEx.list'), 'workoutEx.list')
    const exercise = expectRow<{ id: string }>(
      r.from('workout_exercises').select('*').single().insert({ workout_id: workoutId, exercise_key: key, exercise_name: name, position: existing.length }, 'workoutEx.insert', 'representation'),
      'workoutEx.insert',
      201,
    )
    if (!exercise) continue
    const [prior, goal] = batch([
      r.from('workout_sets').select('*').eq('exercise_key', key).order('created_at', { ascending: false }).limit(30).prepare('GET', 'sets.prior'),
      r.from('strength_goals').select('*').eq('exercise_key', key).prepare('GET', 'goal.get'),
    ])
    expectStatus(prior, 'sets.prior')
    expectStatus(goal, 'goal.get')

    const blanks = [1, 2, 3].map((n) => ({ workout_id: workoutId, workout_exercise_id: exercise.id, exercise_key: key, exercise_name: name, set_number: n, reps: null, weight_lb: null }))
    expectStatus(r.from('workout_sets').insert(blanks, 'sets.insert'), 'sets.insert', 201)
    const mine = readWorkout(r, workoutId)
      .filter((s) => s.workout_exercise_id === exercise.id)
      .sort((a, b) => a.set_number - b.set_number)

    for (const set of mine) {
      think(8, 15) // the rest timer, compressed
      expectStatus(r.from('workout_sets').eq('id', set.id).update({ reps: between(5, 8), weight_lb: base ? base - between(0, 2) * 5 : null, effort: between(7, 9) }, 'sets.update'), 'sets.update', 204)
    }
  }

  think(1, 3)
  expectStatus(r.from('workouts').eq('id', workoutId).update({ completed: true }, 'workouts.update'), 'workouts.update', 204)
  readWorkout(r, workoutId)
  think(2, 4)
}
