import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, runId, test } from '../fixtures'
import { clearDiaryDay, clearExerciseDay, exerciseEntries, todayISO } from '../support/data'
import { authFile } from '../support/env'
import { loseReplyOnce, refuseOnce, waitForIdle } from '../support/network'

// The same save sent twice, a save whose reply never arrives, a save the
// server refuses: the database must end up with the write exactly once (or,
// if it was refused, not at all), and the screen must show what the server
// has. Faults come from request interception, so each run takes the same path;
// waits are on the app going idle, never on a fixed delay.
test.use({ storageState: authFile('judy') })
test.describe.configure({ retries: 0 })

const CYCLING = 'Cycling (moderate, 12–14 mph)'

async function weighInsOf(db: SupabaseClient, lb: number) {
  const { data, error } = await db.from('measurements').select('id').eq('type', 'weight').eq('value', lb)
  if (error) throw new Error(`weighInsOf(${lb}): ${error.message}`)
  return data
}

async function clearWeighIns(db: SupabaseClient, lb: number): Promise<void> {
  const { error } = await db.from('measurements').delete().eq('type', 'weight').eq('value', lb)
  if (error) throw new Error(`clearWeighIns(${lb}): ${error.message}`)
}

async function workoutsOn(db: SupabaseClient, date: string) {
  const { data, error } = await db.from('workouts').select('id').eq('workout_date', date)
  if (error) throw new Error(`workoutsOn(${date}): ${error.message}`)
  return data
}

async function entriesNamed(db: SupabaseClient, date: string, name: string) {
  const { data, error } = await db.from('diary_entries').select('id').eq('entry_date', date).eq('food_name', name)
  if (error) throw new Error(`entriesNamed(${name}): ${error.message}`)
  return data
}

test.describe('double taps', () => {
  test('double-tapping Add on a weigh-in saves it once', async ({ page, judyDb, progressPage }) => {
    const lb = 161.1
    await clearWeighIns(judyDb, lb)
    await progressPage.goto()
    await expect(progressPage.heading).toBeVisible()

    await progressPage.weightInput.fill(String(lb))
    await progressPage.addButton.dblclick()
    await waitForIdle(page)

    expect(await weighInsOf(judyDb, lb)).toHaveLength(1)
  })

  test('double-tapping Add exercise saves the session once', async ({ page, judyDb, cardioPage: cardio }) => {
    const date = '2024-03-01'
    await clearExerciseDay(judyDb, date)
    await cardio.openFor(date)
    await cardio.pickActivity(CYCLING)
    await cardio.setDuration(30)

    await cardio.saveButton.dblclick()
    await expect(page).toHaveURL(/\/\?date=/)
    await waitForIdle(page)

    expect(await exerciseEntries(judyDb, date)).toHaveLength(1)
  })

  test('double-tapping "Add to" in Quick add logs one entry', async ({
    page,
    judyDb,
    diaryPage: diary,
    foodPickerPage: picker,
  }) => {
    const date = '2024-03-02'
    const name = `Double tap ${runId()}`
    await clearDiaryDay(judyDb, date)
    await diary.gotoDate(date)
    await diary.openAddFood('Snacks')

    await picker.quickAddButton.click()
    await page.getByLabel('Name (optional)').fill(name)
    await page.getByLabel('Calories', { exact: true }).fill('120')
    await page.getByRole('button', { name: 'Add to snacks' }).dblclick()
    await waitForIdle(page)

    expect(await entriesNamed(judyDb, date, name)).toHaveLength(1)
    // By URL, not Done: the second tap lands on whatever was under the sheet.
    await diary.gotoDate(date)
    await waitForIdle(page)
    await expect(diary.entryRow(name, 120)).toHaveCount(1)
  })
})

test.describe('lost and refused replies', () => {
  test('a diary entry whose reply is lost is saved once and shown once', async ({
    page,
    judyDb,
    diaryPage: diary,
    foodPickerPage: picker,
  }) => {
    const date = '2024-03-03'
    const name = `Lost reply ${runId()}`
    await clearDiaryDay(judyDb, date)
    await diary.gotoDate(date)
    await diary.openAddFood('Snacks')
    const lost = await loseReplyOnce(page, 'diary_entries', 'POST')

    await picker.quickAdd('snacks', name, 130)
    expect(await lost.committed, 'the server saved it; only the reply was lost').toBe(201)
    await waitForIdle(page)
    await picker.doneButton.click()
    await waitForIdle(page)

    expect(await entriesNamed(judyDb, date, name)).toHaveLength(1)
    await expect(diary.entryRow(name, 130)).toHaveCount(1)
  })

  test('a diary entry the server refuses is not kept, on the server or on screen', async ({
    page,
    judyDb,
    diaryPage: diary,
    foodPickerPage: picker,
  }) => {
    const date = '2024-03-04'
    const name = `Refused ${runId()}`
    await clearDiaryDay(judyDb, date)
    await diary.gotoDate(date)
    await diary.openAddFood('Snacks')
    await refuseOnce(page, 'diary_entries', 'POST', 503)

    await picker.quickAdd('snacks', name, 140)
    await waitForIdle(page)
    await picker.doneButton.click()
    await waitForIdle(page)

    expect(await entriesNamed(judyDb, date, name)).toEqual([])
    await expect(diary.entryRow(name, 140)).toHaveCount(0)
  })
})

test.describe('trying again after a lost reply', () => {
  test('a weigh-in saved twice by a retry is kept once', async ({ page, judyDb, progressPage }) => {
    const lb = 162.2
    await clearWeighIns(judyDb, lb)
    await progressPage.goto()
    await expect(progressPage.heading).toBeVisible()
    const lost = await loseReplyOnce(page, 'measurements', 'POST')

    await progressPage.logWeight(lb)
    expect(await lost.committed, 'the server saved it; only the reply was lost').toBe(201)
    await waitForIdle(page)
    await expect(progressPage.weightInput, 'the app still shows it unsaved').toHaveValue(String(lb))
    await progressPage.addButton.click() // so you tap Add again
    await waitForIdle(page)

    expect(await weighInsOf(judyDb, lb)).toHaveLength(1)
  })

  test('a cardio session saved twice by a retry is kept once', async ({ page, judyDb, cardioPage: cardio }) => {
    const date = '2024-03-05'
    await clearExerciseDay(judyDb, date)
    await cardio.openFor(date)
    await cardio.pickActivity(CYCLING)
    await cardio.setDuration(30)
    const lost = await loseReplyOnce(page, 'exercise_entries', 'POST')

    await cardio.saveButton.click()
    expect(await lost.committed, 'the server saved it; only the reply was lost').toBe(201)
    await expect(page.getByText(/^Couldn't save/)).toBeVisible()
    await cardio.save() // so you tap Add exercise again
    await waitForIdle(page)

    expect(await exerciseEntries(judyDb, date)).toHaveLength(1)
  })

  test('a workout started twice by a retry is one workout', async ({ page, judyDb, workoutPage }) => {
    const today = todayISO()
    const { error } = await judyDb.from('workouts').delete().eq('workout_date', today)
    if (error) throw new Error(error.message)
    await workoutPage.goto()
    const lost = await loseReplyOnce(page, 'workouts', 'POST')

    await workoutPage.startEmptyButton.click()
    await workoutPage.checkin.startWorkout()
    expect(await lost.committed, 'the server saved it; only the reply was lost').toBe(201)
    await waitForIdle(page)
    await expect(workoutPage.checkin.dialog, 'the check-in is still open').toBeVisible()
    await workoutPage.checkin.startWorkout() // so you tap Start again
    await expect(page).toHaveURL(/\/workout\/[0-9a-f-]+$/)

    const started = await workoutsOn(judyDb, today)
    expect(started).toHaveLength(1)
    expect(page.url()).toContain(started[0].id)
  })
})
