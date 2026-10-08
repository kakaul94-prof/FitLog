import { expect, runId, test } from '../fixtures'
import { createRoutine, routineExercises } from '../support/data'
import { authFile } from '../support/env'

// Workout templates, as Dave: templates change what the Exercise tab offers,
// so they live on their own account rather than Alice's (support/env.ts).
test.use({ storageState: authFile('dave') })

test('creates a template with exercises and targets', async ({ daveDb, routinePage, page }) => {
  const name = `E2E Push ${runId()}`
  await routinePage.goto()
  await routinePage.newTemplateButton.click()
  await expect(page).toHaveURL(/\/routines\/new$/)

  await routinePage.nameInput.fill(name)
  await routinePage.addExercise('Bench Press')
  await routinePage.setTargets('Bench Press', 3, 8)
  await routinePage.addExercise('Overhead Press')
  await routinePage.setTargets('Overhead Press', 4, 10)
  await routinePage.save()

  const { data: saved } = await daveDb.from('routines').select('id').eq('name', name).single()
  expect(await routineExercises(daveDb, saved!.id)).toEqual([
    { exercise_name: 'Bench Press', target_sets: 3, target_reps: 8 },
    { exercise_name: 'Overhead Press', target_sets: 4, target_reps: 10 },
  ])
  await routinePage.goto()
  await expect(routinePage.templateLink(name)).toBeVisible()
})

test('starts a workout from a template', async ({ daveDb, routinePage, page }) => {
  const pull = await createRoutine(daveDb, `E2E Pull ${runId()}`, [
    { key: 'barbell_row', name: 'Barbell Row', sets: 3, reps: 8 },
    { key: 'lat_pulldown', name: 'Lat Pulldown', sets: 3, reps: 12 },
  ])
  await routinePage.goto()

  const workoutId = await routinePage.start(pull.name)

  await expect(page.getByText('Barbell Row').first()).toBeVisible()
  await expect(page.getByText('Lat Pulldown').first()).toBeVisible()
  // Linked to its template, exercises in template order, one starter set each
  // (targets stay on the template; they are not copied in as sets).
  const { data: workout } = await daveDb
    .from('workouts')
    .select('name, source_routine_id, completed, workout_exercises(exercise_name, position, workout_sets(set_number))')
    .eq('id', workoutId)
    .single()
  expect(workout).toMatchObject({ name: pull.name, source_routine_id: pull.id, completed: false })
  const exercises = [...workout!.workout_exercises].sort((a, b) => a.position - b.position)
  expect(exercises.map((e) => [e.exercise_name, e.workout_sets.length])).toEqual([
    ['Barbell Row', 1],
    ['Lat Pulldown', 1],
  ])

  // Don't leave an unfinished workout on Dave's Exercise tab for later runs.
  await daveDb.from('workouts').delete().eq('id', workoutId)
})

test('leaving with unsaved edits: Discard keeps the saved version, Save keeps the edit', async ({
  daveDb,
  routinePage,
}) => {
  const legs = await createRoutine(daveDb, `E2E Legs ${runId()}`, [
    { key: 'back_squat', name: 'Back Squat', sets: 3, reps: 5 },
  ])

  await routinePage.open(legs.id, legs.name)
  await routinePage.setTargets('Back Squat', 5, 5)
  await routinePage.leave('Discard changes')
  expect(await routineExercises(daveDb, legs.id)).toEqual([{ exercise_name: 'Back Squat', target_sets: 3, target_reps: 5 }])

  await routinePage.open(legs.id, legs.name)
  await expect(routinePage.targetSets('Back Squat')).toHaveValue('3')
  await routinePage.setTargets('Back Squat', 5, 5)
  await routinePage.leave('Save changes')
  expect(await routineExercises(daveDb, legs.id)).toEqual([{ exercise_name: 'Back Squat', target_sets: 5, target_reps: 5 }])
})
