import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, runId, test } from '../fixtures'
import { clearDiaryDay, clearExerciseDay, exerciseEntries } from '../support/data'
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

async function entriesNamed(db: SupabaseClient, date: string, name: string) {
  const { data, error } = await db.from('diary_entries').select('id').eq('entry_date', date).eq('food_name', name)
  if (error) throw new Error(`entriesNamed(${name}): ${error.message}`)
  return data
}

test.describe('double taps', () => {
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
    await picker.doneButton.click()
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
