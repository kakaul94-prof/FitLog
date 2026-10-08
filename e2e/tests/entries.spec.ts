import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, runId, test } from '../fixtures'
import { addWeighIn, clearDiaryDay, createFood, diaryDay, logFood, todayISO, weighIns } from '../support/data'
import { authFile } from '../support/env'

// Editing and deleting logged entries, as Heidi: her own account, so these
// edits can't touch anyone else's data. Each test owns one date and clears it
// first, and its foods carry a runId so reruns never collide.
test.use({ storageState: authFile('heidi') })

/** Log foods (150 cal per serving each) to a day's snacks; returns their names in order. */
async function seedDay(db: SupabaseClient, date: string, ...labels: string[]): Promise<string[]> {
  await clearDiaryDay(db, date)
  const id = runId()
  const names: string[] = []
  for (const label of labels) {
    const food = await createFood(db, `E2E ${label} ${id}`, 150)
    await logFood(db, food, { date })
    names.push(food.name)
  }
  return names
}

test.describe('the entry page', () => {
  test('changing servings updates the calories', async ({ heidiDb, diaryPage: diary, entryPage: entry }) => {
    const day = '2025-02-01'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)

    await diary.entryRow(oats, 150).click()
    await entry.servingsInput.fill('2')
    await entry.saveChangesButton.click()

    await expect(diary.entryRow(oats, 300)).toBeVisible()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([{ food_name: oats, meal: 'snacks', servings: 2 }])
  })

  test('changing the meal moves the entry', async ({ heidiDb, diaryPage: diary, entryPage: entry }) => {
    const day = '2025-02-02'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)

    await diary.entryRow(oats, 150).click()
    await entry.mealSelect.selectOption('dinner') // saves straight away
    await entry.backButton.click()

    await expect(diary.mealTotal('Dinner', 150)).toBeVisible()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([{ food_name: oats, meal: 'dinner', servings: 1 }])
  })

  test('deleting asks first, then removes the entry', async ({ heidiDb, diaryPage: diary, entryPage: entry, page }) => {
    const day = '2025-02-03'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)

    await diary.entryRow(oats, 150).click()
    page.once('dialog', (dialog) => void dialog.accept())
    await entry.deleteButton.click()

    await expect(diary.entryRow(oats, 150)).toBeHidden()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([])
  })

  test('leaving with unsaved servings: Keep editing stays, Discard keeps the original', async ({
    heidiDb,
    diaryPage: diary,
    entryPage: entry,
  }) => {
    const day = '2025-02-04'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)
    await diary.entryRow(oats, 150).click()
    await entry.servingsInput.fill('3')

    await entry.backButton.click()
    await entry.promptButton('Keep editing').click()
    await expect(entry.servingsInput).toHaveValue('3')

    await entry.backButton.click()
    await entry.promptButton('Discard changes').click()
    await expect(diary.entryRow(oats, 150)).toBeVisible()
    expect(await diaryDay(heidiDb, day)).toEqual([{ food_name: oats, meal: 'snacks', servings: 1 }])
  })

  test('leaving with unsaved servings: Save keeps the edit', async ({ heidiDb, diaryPage: diary, entryPage: entry }) => {
    const day = '2025-02-05'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)
    await diary.entryRow(oats, 150).click()
    await entry.servingsInput.fill('2')

    await entry.backButton.click()
    await entry.promptButton('Save').click()

    await expect(diary.entryRow(oats, 300)).toBeVisible()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([{ food_name: oats, meal: 'snacks', servings: 2 }])
  })
})

test.describe('the diary', () => {
  test('press and hold → Delete entry', async ({ heidiDb, diaryPage: diary }) => {
    const day = '2025-02-06'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)

    await diary.openMenu(diary.entryRow(oats, 150))
    await diary.menuAction('Delete entry').click()

    await expect(diary.entryRow(oats, 150)).toBeHidden()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([])
  })

  test('press and hold → Move to meal', async ({ heidiDb, diaryPage: diary, page }) => {
    const day = '2025-02-07'
    const [oats] = await seedDay(heidiDb, day, 'Oats')
    await diary.gotoDate(day)

    await diary.openMenu(diary.entryRow(oats, 150))
    await diary.menuAction('Move to meal').click()
    await page.getByRole('button', { name: 'Dinner', exact: true }).click()

    await expect(diary.mealTotal('Dinner', 150)).toBeVisible()
    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([{ food_name: oats, meal: 'dinner', servings: 1 }])
  })

  test('select two of three entries and delete only those', async ({ heidiDb, diaryPage: diary, page }) => {
    const day = '2025-02-08'
    const [apple, bagel, cereal] = await seedDay(heidiDb, day, 'Apple', 'Bagel', 'Cereal')
    await diary.gotoDate(day)

    await diary.openMenu(diary.entryRow(apple, 150))
    await diary.menuAction('Select multiple').click() // selects the pressed entry
    await diary.entryRow(bagel, 150).click()
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect.poll(() => diaryDay(heidiDb, day)).toEqual([{ food_name: cereal, meal: 'snacks', servings: 1 }])
    await expect(diary.entryRow(cereal, 150)).toBeVisible()
    await expect(diary.entryRow(apple, 150)).toBeHidden()
  })

  test("the picker's just-added tray changes servings and removes the entry", async ({
    heidiDb,
    diaryPage: diary,
    foodPickerPage: picker,
    page,
  }) => {
    const day = '2025-02-09'
    await clearDiaryDay(heidiDb, day)
    const toast = await createFood(heidiDb, `E2E Toast ${runId()}`, 150)
    await diary.gotoDate(day)
    await diary.openAddFood('Snacks')
    await picker.search(toast.name)
    await picker.addFood(toast.name, 'snacks')

    await page.getByRole('button', { name: /added ·/ }).click() // open the tray
    const updated = page.waitForResponse((r) => r.url().includes('/rest/v1/diary_entries') && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Increase servings' }).click()
    await updated
    expect(await diaryDay(heidiDb, day)).toEqual([{ food_name: toast.name, meal: 'snacks', servings: 2 }])

    const removed = page.waitForResponse((r) => r.url().includes('/rest/v1/diary_entries') && r.request().method() === 'DELETE')
    await page.getByRole('button', { name: 'Remove entry' }).click()
    await removed
    expect(await diaryDay(heidiDb, day)).toEqual([])
  })
})

test('weigh-ins: change one’s date, delete another', async ({ heidiDb, progressPage: progress }) => {
  const daysAgo = (n: number) => {
    const d = new Date(`${todayISO()}T12:00:00`)
    d.setDate(d.getDate() - n)
    return d.toLocaleDateString('en-CA')
  }
  await heidiDb.from('measurements').delete().eq('type', 'weight')
  await addWeighIn(heidiDb, daysAgo(10), 150.5)
  await addWeighIn(heidiDb, daysAgo(9), 151.5)
  await progress.goto()

  await progress.changeWeighInDate(150.5, daysAgo(3))
  await progress.deleteWeighIn(151.5)

  await expect.poll(() => weighIns(heidiDb)).toEqual([{ measured_on: daysAgo(3), value: 150.5 }])
})
