import type { Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, runId, test } from '../fixtures'
import { EntryPage } from '../pages/EntryPage'
import { addDiaryEntry, clearDiaryDay } from '../support/data'
import { authFile } from '../support/env'
import { holdNext, readPersistedCache, waitForIdle, withQuery } from '../support/network'

// Stale data and other devices. The app shows cached data at once (from memory,
// or from IndexedDB after a restart) and replaces it with the server's version
// when it refetches. These pin down when that happens: always after a restart,
// and otherwise once the cached day is over a minute old (staleTime 60 s; the
// app doesn't refetch on focus). Edits send only the fields they change, so two
// devices editing different fields of an entry don't undo each other.
// Time is moved with Playwright's fake clock; network order with interception.
test.use({ storageState: authFile('judy') })
test.describe.configure({ retries: 0 })

async function editElsewhere(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('diary_entries').update(patch).eq('id', id)
  if (error) throw new Error(`editElsewhere(${id}): ${error.message}`)
}

/** Wait until the app has saved the day to IndexedDB, so a restart would restore it. */
async function waitForDaySavedToDisk(page: Page, date: string, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const cache = await readPersistedCache(page)
      const day = cache?.clientState.queries.find((q) => q.queryKey[0] === 'diary' && q.queryKey[1] === date)
      return ((day?.state.data as { food_name: string }[] | undefined) ?? []).some((e) => e.food_name === name)
    }, { message: `the ${date} diary saved to IndexedDB` })
    .toBe(true)
}

/** Leave the day and come back, the way you'd flip between days in the diary. */
async function revisitDay(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next day' }).click()
  await page.getByRole('button', { name: 'Previous day' }).click()
}

test('a day restored from the offline cache is replaced by the server version after a restart', async ({
  page,
  judyDb,
  diaryPage: diary,
}) => {
  const date = '2024-04-01'
  const name = `Cached ${runId()}`
  await clearDiaryDay(judyDb, date)
  const id = await addDiaryEntry(judyDb, date, name, 150)
  await diary.gotoDate(date)
  await expect(diary.entryRow(name, 150)).toBeVisible()
  await waitForDaySavedToDisk(page, date, name)

  await editElsewhere(judyDb, id, { servings: 2 })
  const refetch = await holdNext(page, 'diary_entries', 'GET', withQuery(`entry_date=eq.${date}`))
  await page.reload()

  await refetch.arrived
  await expect(diary.entryRow(name, 150), 'the saved copy shows at once').toBeVisible()
  refetch.release()
  await expect(diary.entryRow(name, 300), 'then the server version replaces it').toBeVisible()
  await expect(diary.entryRow(name, 150)).toHaveCount(0)
})

test("another device's edit shows once this device's copy of the day is over a minute old", async ({
  page,
  judyDb,
  diaryPage: diary,
}) => {
  const date = '2024-04-02'
  const name = `Two devices ${runId()}`
  await clearDiaryDay(judyDb, date)
  const id = await addDiaryEntry(judyDb, date, name, 150)
  await page.clock.install()
  await diary.gotoDate(date)
  await expect(diary.entryRow(name, 150)).toBeVisible()

  await editElsewhere(judyDb, id, { servings: 2 })

  // Within the minute this device keeps its copy, even across leaving the day.
  await revisitDay(page)
  await waitForIdle(page)
  await expect(diary.entryRow(name, 150)).toBeVisible()

  // Past the minute, coming back to the day fetches the server's version.
  await page.clock.fastForward('01:01')
  await revisitDay(page)
  await waitForIdle(page)
  await expect(diary.entryRow(name, 300)).toBeVisible()
})

test('edits from two devices to different fields of an entry are both kept', async ({
  page,
  judyDb,
  diaryPage: diary,
}) => {
  const date = '2024-04-03'
  const name = `Merged ${runId()}`
  await clearDiaryDay(judyDb, date)
  const id = await addDiaryEntry(judyDb, date, name, 150)
  await diary.gotoDate(date)
  await expect(diary.entryRow(name, 150)).toBeVisible()

  await editElsewhere(judyDb, id, { servings: 2 }) // the other device changes the servings
  await diary.entryRow(name, 150).click() // this one, still showing 1 serving, moves it to lunch
  await new EntryPage(page).mealSelect.selectOption({ label: 'Lunch' })
  await waitForIdle(page)

  const { data } = await judyDb.from('diary_entries').select('servings, meal').eq('id', id).single()
  expect(data).toEqual({ servings: 2, meal: 'lunch' })
})
