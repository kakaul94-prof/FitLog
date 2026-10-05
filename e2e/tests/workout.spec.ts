import { test, expect, runId } from '../fixtures'

test('logs a strength workout and saves the set', async ({ workoutPage, aliceDb }) => {
  const exercise = `E2E Press ${runId()}`

  await workoutPage.goto()
  await workoutPage.startEmptyWorkout()
  await workoutPage.addCustomExercise(exercise)
  await workoutPage.logSet(1, 135, 8)
  await workoutPage.markDone()

  // The set is stored against a workout that's now marked completed.
  await expect
    .poll(async () => {
      const { data } = await aliceDb
        .from('workout_sets')
        .select('weight_lb, reps, workouts(completed)')
        .eq('exercise_name', exercise)
      return data
    })
    .toEqual([{ weight_lb: 135, reps: 8, workouts: { completed: true } }])
})
