import type { Page, Response } from '@playwright/test'
import { expect, runId, test } from '../fixtures'
import type { DiaryPage } from '../pages/DiaryPage'
import { EntryPage } from '../pages/EntryPage'
import type { FoodPickerPage } from '../pages/FoodPickerPage'
import { addDiaryEntry, clearDiaryDay, clearExerciseDay, createFood, exerciseEntries } from '../support/data'
import { authFile } from '../support/env'
import {
  countReloads,
  goOffline,
  goOnline,
  type HeldRequest,
  holdAll,
  holdNext,
  readPersistedCache,
  statusPill,
  waitForQueuedWritesSaved,
  waitForSync,
  withBody,
  withQuery,
  writeQueue,
  writePersistedCache,
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

test.describe('logging several entries in a row while offline', () => {
  test('from Quick add', async ({ page, judyDb, diaryPage: diary, foodPickerPage: picker }) => {
    const date = '2024-02-03'
    const names = ['one', 'two', 'three'].map((n) => `In a row ${n} ${runId()}`)
    await clearDiaryDay(judyDb, date)
    await openPickerOnline(diary, picker, date)

    await goOffline(page)
    for (const [i, name] of names.entries()) await quickAddOffline(picker, name, 300 + i)
    await expect(pending(page, 3)).toBeVisible()

    await goOnline(page)
    await waitForSync(page)
    expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual(names)
  })

  test('from your food library', async ({ page, judyDb, diaryPage: diary, foodPickerPage: picker }) => {
    const date = '2024-02-04'
    const foods = [await createFood(judyDb, `Library A ${runId()}`, 110), await createFood(judyDb, `Library B ${runId()}`, 120)]
    await clearDiaryDay(judyDb, date)
    await openPickerOnline(diary, picker, date)
    for (const food of foods) await expect(picker.foodRow(food.name)).toBeVisible()

    await goOffline(page)
    for (const food of foods) {
      await picker.foodRow(food.name).click()
      await page.getByRole('button', { name: 'Add to snacks' }).click()
      await expect(picker.message(`Added ${food.name}`)).toBeVisible()
    }
    await expect(pending(page, 2)).toBeVisible()

    await goOnline(page)
    await waitForSync(page)
    expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual(foods.map((f) => f.name))
  })
})

/** Wait for a response without leaving an unhandled rejection if it never comes. */
function responseTo(page: Page, table: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  const response = page.waitForResponse((r) => {
    const req = r.request()
    if (new URL(r.url()).pathname !== `/rest/v1/${table}` || req.method() !== method) return false
    return !body || withBody(body)(req)
  })
  response.catch(() => {})
  return response
}

/**
 * Replay the queue in the worst order the app allows. The first write is held
 * at the network; if the app has sent later writes alongside it, they land
 * first and only then is it let through. A queue that keeps order never sends
 * a later write until the earlier one is done (it shows as waiting), so it
 * finishes in order whatever the network does.
 */
async function letLaterWritesLandFirst(page: Page, first: HeldRequest, later: Promise<Response>): Promise<void> {
  await first.arrived
  const waiting = (await writeQueue(page)).filter((w) => w.status === 'pending' && w.paused)
  if (waiting.length === 0) await later // sent alongside the first: let it overtake
  first.release()
}

test.describe('the queue replays in the order things were done', () => {
  test('an entry added and then deleted offline stays deleted', async ({
    page,
    judyDb,
    diaryPage: diary,
    foodPickerPage: picker,
  }) => {
    const date = '2024-02-05'
    const name = `Added then deleted ${runId()}`
    await clearDiaryDay(judyDb, date)
    await openPickerOnline(diary, picker, date)

    await goOffline(page)
    await quickAddOffline(picker, name, 150)
    await picker.doneButton.click()
    await diary.openMenu(diary.entryRow(name, 150))
    await diary.menuAction('Delete entry').click()
    await expect(diary.entryRow(name, 150)).toHaveCount(0)
    await expect(pending(page, 2)).toBeVisible()

    const insert = await holdNext(page, 'diary_entries', 'POST')
    const deleted = responseTo(page, 'diary_entries', 'DELETE')
    await goOnline(page)
    await letLaterWritesLandFirst(page, insert, deleted)
    await waitForSync(page)

    expect(await savedEntries(judyDb, date), 'the deleted entry must not come back').toEqual([])
    await expect(diary.entryRow(name, 150)).toHaveCount(0)
  })

  test('the last of two offline edits to an entry is the one kept', async ({
    page,
    judyDb,
    diaryPage: diary,
  }) => {
    const date = '2024-02-06'
    const name = `Edited twice ${runId()}`
    await clearDiaryDay(judyDb, date)
    await addDiaryEntry(judyDb, date, name, 100)
    const entry = new EntryPage(page)
    await diary.gotoDate(date)
    await diary.entryRow(name, 100).click()
    await expect(entry.servingsInput).toHaveValue('1') // the edit screen is loaded while online

    await goOffline(page)
    for (const servings of [2, 3]) {
      if (servings > 2) await diary.entryRow(name, 200).click()
      await entry.servingsInput.fill(String(servings))
      await entry.saveChangesButton.click()
      await expect(diary.entryRow(name, 100 * servings)).toBeVisible()
    }
    await expect(pending(page, 2)).toBeVisible()

    const firstEdit = await holdNext(page, 'diary_entries', 'PATCH', withBody({ servings: 2 }))
    const secondEdit = responseTo(page, 'diary_entries', 'PATCH', { servings: 3 })
    await goOnline(page)
    await letLaterWritesLandFirst(page, firstEdit, secondEdit)
    await waitForSync(page)

    expect((await savedEntries(judyDb, date)).map((e) => e.servings), 'the later edit wins').toEqual([3])
    await expect(diary.entryRow(name, 300)).toBeVisible()
  })
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

test('a save replayed after it already reached the server counts as done', async ({
  page,
  context,
  judyDb,
  diaryPage: diary,
  foodPickerPage: picker,
}) => {
  const date = '2024-02-07'
  const name = `Replayed ${runId()}`
  await clearDiaryDay(judyDb, date)
  await openPickerOnline(diary, picker, date)

  // Log offline and keep a copy of what the app saved to disk: the entry queued.
  await goOffline(page)
  await quickAddOffline(picker, name, 160)
  await waitForQueuedWritesSaved(page, 1)
  const savedWithEntryQueued = await readPersistedCache(page)
  expect(savedWithEntryQueued).toBeDefined()

  // Back online, it syncs...
  await goOnline(page)
  await waitForSync(page)
  expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual([name])

  // ...but the app dies before saving that it did, so it reopens with the old copy.
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/icon.svg') // same origin, but the app doesn't run here
  await writePersistedCache(reopened, savedWithEntryQueued!)
  const day = await holdAll(reopened, 'diary_entries', 'GET', withQuery(`entry_date=eq.${date}`))
  const replay = responseTo(reopened, 'diary_entries', 'POST')
  await reopened.goto(`/?date=${date}`)

  expect((await replay).status(), 'the queued save is sent again and the server already has it').toBe(409)
  await expect
    .poll(async () => (await writeQueue(reopened)).find((w) => w.key === 'diary/quickAdd')?.status)
    .not.toBe('pending')
  expect((await writeQueue(reopened)).find((w) => w.key === 'diary/quickAdd')?.status, 'the replay counts as done').toBe('success')
  await expect(reopened.getByRole('button', { name: `${name} 160`, exact: true }), 'the entry stays on screen').toBeVisible()

  day.release()
  expect((await savedEntries(judyDb, date)).map((e) => e.food_name)).toEqual([name])
  await expect(reopened.getByRole('button', { name: `${name} 160`, exact: true })).toHaveCount(1)
})

test.describe('weigh-ins and cardio logged offline survive closing the app', () => {
  /** Reopen the app online and wait until every write it restored has been tried. */
  async function reopenAndSettle(context: import('@playwright/test').BrowserContext, path: string): Promise<Page> {
    await context.setOffline(false)
    const reopened = await context.newPage()
    await reopened.goto(path)
    await expect
      .poll(async () => {
        const queue = await writeQueue(reopened)
        return queue.length > 0 && queue.every((w) => w.status !== 'pending')
      }, { message: 'the restored writes have been sent' })
      .toBe(true)
    return reopened
  }

  test('a weigh-in', async ({ page, context, judyDb, progressPage }) => {
    const lb = 163.3
    await judyDb.from('measurements').delete().eq('type', 'weight').eq('value', lb)
    await progressPage.goto()
    await expect(progressPage.heading).toBeVisible()

    await goOffline(page)
    await progressPage.logWeight(lb)
    await expect(pending(page, 1)).toBeVisible()
    await waitForQueuedWritesSaved(page, 1)
    await page.close()

    await reopenAndSettle(context, '/progress')
    const { data } = await judyDb.from('measurements').select('id').eq('type', 'weight').eq('value', lb)
    expect(data, 'the weigh-in logged offline reached the server once').toHaveLength(1)
  })

  test('a cardio session', async ({ page, context, judyDb, cardioPage: cardio }) => {
    const date = '2024-02-08'
    await clearExerciseDay(judyDb, date)
    await cardio.openFor(date)
    await cardio.pickActivity('Cycling (moderate, 12–14 mph)')
    await cardio.setDuration(30)

    await goOffline(page)
    await cardio.saveButton.click()
    await expect(pending(page, 1)).toBeVisible()
    await waitForQueuedWritesSaved(page, 1)
    await page.close()

    await reopenAndSettle(context, `/?date=${date}`)
    expect(await exerciseEntries(judyDb, date), 'the session logged offline reached the server once').toHaveLength(1)
  })
})
