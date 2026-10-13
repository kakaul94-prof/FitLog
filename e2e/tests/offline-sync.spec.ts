import type { Page } from '@playwright/test'
import { expect, runId, test } from '../fixtures'
import type { DiaryPage } from '../pages/DiaryPage'
import type { FoodPickerPage } from '../pages/FoodPickerPage'
import { clearDiaryDay } from '../support/data'
import { authFile } from '../support/env'
import {
  countReloads,
  goOffline,
  goOnline,
  statusPill,
  waitForQueuedWritesSaved,
  waitForSync,
} from '../support/network'

// Logging while offline, then coming back. The diary keeps writes in a queue
// (TanStack Query's paused mutations, saved to IndexedDB) and sends them when
// the connection returns. Every wait here is on a condition (the status pill,
// the saved queue, a response), never a fixed delay, and retries are off: a
// resilience test that only passes on its second try is a failure.
test.use({ storageState: authFile('judy') })
test.describe.configure({ retries: 0 })

/** Diary rows for a day, oldest first: the order the diary shows them in. */
async function savedEntries(db: import('@supabase/supabase-js').SupabaseClient, date: string) {
  const { data, error } = await db
    .from('diary_entries')
    .select('id, food_name, servings, created_at')
    .eq('entry_date', date)
    .order('created_at')
  if (error) throw new Error(`savedEntries(${date}): ${error.message}`)
  return data
}

/**
 * Open a day's food picker once while online, so the screens used offline are
 * already loaded (the dev server can't serve them once the browser is offline).
 */
async function openPickerOnline(diary: DiaryPage, picker: FoodPickerPage, date: string): Promise<void> {
  await diary.gotoDate(date)
  await diary.openAddFood('Snacks')
  await expect(picker.quickAddButton).toBeVisible()
}

async function quickAddOffline(picker: FoodPickerPage, name: string, kcal: number): Promise<void> {
  await picker.quickAdd('snacks', name, kcal)
  await expect(picker.message(`Added ${name}`)).toBeVisible()
}

const pending = (page: Page, n: number) => page.getByText(`Offline · ${n} pending`, { exact: true })

test('entries logged offline all reach the server once, in the order they were logged', async ({
  page,
  judyDb,
  diaryPage: diary,
  foodPickerPage: picker,
}) => {
  const date = '2024-02-01'
  const names = ['first', 'second', 'third'].map((n) => `Queued ${n} ${runId()}`)
  await clearDiaryDay(judyDb, date)
  await openPickerOnline(diary, picker, date)
  const reloads = countReloads(page)

  await goOffline(page)
  for (const [i, name] of names.entries()) {
    if (i > 0) await diary.openAddFood('Snacks') // a fresh visit to the picker for each entry
    await quickAddOffline(picker, name, 100 + i)
    await picker.doneButton.click()
    await expect(diary.entryRow(name, 100 + i)).toBeVisible() // shown at once, before it syncs
  }
  await expect(pending(page, 3)).toBeVisible()
  expect(await savedEntries(judyDb, date)).toEqual([]) // nothing has left the phone yet

  await goOnline(page)
  await waitForSync(page)

  expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual(names)
  for (const [i, name] of names.entries()) await expect(diary.entryRow(name, 100 + i)).toHaveCount(1)
  expect(reloads(), 'synced in the same session, without a reload').toBe(0)
})

test('an entry logged offline survives closing the app and syncs when it reopens online', async ({
  page,
  context,
  judyDb,
  diaryPage: diary,
  foodPickerPage: picker,
}) => {
  const date = '2024-02-02'
  const name = `Kept offline ${runId()}`
  await clearDiaryDay(judyDb, date)
  await openPickerOnline(diary, picker, date)

  await goOffline(page)
  await quickAddOffline(picker, name, 210)
  await waitForQueuedWritesSaved(page, 1)
  await page.close() // the app is killed with the write still queued

  await context.setOffline(false)
  const reopened = await context.newPage()
  const sent = reopened.waitForResponse(
    (r) => new URL(r.url()).pathname === '/rest/v1/diary_entries' && r.request().method() === 'POST',
  )
  await reopened.goto(`/?date=${date}`)
  expect((await sent).status(), 'the restored write is sent once the app reopens').toBe(201)
  await waitForSync(reopened)

  expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual([name])
  await expect(reopened.getByRole('button', { name: `${name} 210`, exact: true })).toHaveCount(1)
  await expect(statusPill(reopened)).toBeHidden()
})
