import { expect, runId, test } from '../fixtures'
import type { CardioPage } from '../pages/CardioPage'
import { clearExerciseDay, exerciseEntries } from '../support/data'
import { authFile } from '../support/env'

// Logging cardio, as Erin. She weighs exactly 80 kg (seed.sql), so expected
// calories are worked out by hand from the app's formulas:
//   by time:     MET × 3.5 × kg ÷ 200 × minutes
//   by distance: kg × km × (1.0 if MET ≥ 7, else 0.6)
// Each test owns one date and clears it first, so tests run in parallel and
// rerun without leftovers.
test.use({ storageState: authFile('erin') })

const CYCLING = 'Cycling (moderate, 12–14 mph)' // MET 8: 8 × 3.5 × 80 ÷ 200 × 30 = 336

async function logCycling(cardio: CardioPage, day: string, minutes: number): Promise<void> {
  await cardio.openFor(day)
  await cardio.pickActivity(CYCLING)
  await cardio.setDuration(minutes)
}

test('logs an activity with calories estimated from MET, time and weight', async ({ erinDb, cardioPage: cardio }) => {
  const day = '2025-01-01'
  await clearExerciseDay(erinDb, day)

  await logCycling(cardio, day, 30)
  await expect(cardio.calories(336)).toBeVisible()
  await cardio.save()

  await expect(cardio.diaryRow(CYCLING)).toContainText('336')
  expect(await exerciseEntries(erinDb, day)).toEqual([
    expect.objectContaining({ name: CYCLING, met: 8, duration_min: 30, calories: 336 }),
  ])
})

test('saves your own calorie number instead of the estimate', async ({ erinDb, cardioPage: cardio }) => {
  const day = '2025-01-02'
  await clearExerciseDay(erinDb, day)

  await logCycling(cardio, day, 30)
  await cardio.overrideCalories(336, 500)
  await expect(cardio.calories(500)).toBeVisible()
  await cardio.save()

  expect(await exerciseEntries(erinDb, day)).toEqual([expect.objectContaining({ duration_min: 30, calories: 500 })])
})

test('a distance-based activity prices the distance', async ({ erinDb, cardioPage: cardio }) => {
  const day = '2025-01-03'
  const run = 'Running (treadmill)' // MET 9.8 ≥ 7: 80 kg × 4.828 km × 1.0 = 386
  await clearExerciseDay(erinDb, day)

  await cardio.openFor(day)
  await cardio.pickActivity(run)
  await cardio.setDuration(30)
  await cardio.setDistance(3)
  await expect(cardio.calories(386)).toBeVisible()
  await cardio.save()

  expect(await exerciseEntries(erinDb, day)).toEqual([
    expect.objectContaining({ name: run, duration_min: 30, distance_mi: 3, calories: 386 }),
  ])
})

test('editing recalculates and saves; deleting removes it', async ({ erinDb, cardioPage: cardio }) => {
  const day = '2025-01-04'
  await clearExerciseDay(erinDb, day)
  await logCycling(cardio, day, 30)
  await cardio.save()

  await cardio.diaryRow(CYCLING).click() // tap = edit
  await cardio.setDuration(45)
  await expect(cardio.calories(504)).toBeVisible() // 336 × 45 ÷ 30
  await cardio.save()
  await expect(cardio.diaryRow(CYCLING)).toContainText('504')
  expect(await exerciseEntries(erinDb, day)).toEqual([expect.objectContaining({ duration_min: 45, calories: 504 })])

  await cardio.deleteFromDiary(CYCLING)
  await expect(cardio.diaryRow(CYCLING)).toBeHidden()
  await expect.poll(() => exerciseEntries(erinDb, day)).toEqual([])
})

test('a custom activity uses its own MET and is offered again', async ({ erinDb, cardioPage: cardio, page }) => {
  const day = '2025-01-05'
  const sled = `E2E Sled push ${runId()}` // MET 6: 6 × 3.5 × 80 ÷ 200 × 20 = 168
  await clearExerciseDay(erinDb, day)

  await cardio.openFor(day)
  await cardio.searchBox.fill(sled)
  await page.getByRole('button', { name: `New custom activity "${sled}"` }).click()
  await page.getByLabel('Name', { exact: true }).fill(sled)
  await page.getByLabel('Intensity (MET)').fill('6')
  await page.getByRole('button', { name: 'Add activity' }).click()
  await cardio.setDuration(20)
  await expect(cardio.calories(168)).toBeVisible()
  await cardio.save()

  expect(await exerciseEntries(erinDb, day)).toEqual([
    expect.objectContaining({ name: sled, met: 6, duration_min: 20, calories: 168 }),
  ])
  await cardio.openFor(day)
  await cardio.searchBox.fill(sled)
  await expect(page.getByRole('button', { name: new RegExp(`^${sled}`) }).first()).toBeVisible()
})

test("exercise raises the day's calorie budget by what it burned", async ({ erinDb, cardioPage: cardio, page }) => {
  const day = '2025-01-06'
  await clearExerciseDay(erinDb, day)
  await page.goto(`/?date=${day}`)
  await expect(cardio.remaining(2000)).toBeVisible() // Erin's goal, nothing logged

  await logCycling(cardio, day, 30)
  await cardio.save()

  await expect(cardio.remaining(2336)).toBeVisible() // 2000 + 336
})
