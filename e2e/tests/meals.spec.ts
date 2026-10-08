import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, runId, test } from '../fixtures'
import { clearDiaryDay, createFood, createMeal, diaryDay, logFood, savedMeal } from '../support/data'

// Saved meals and copying entries between days, as Alice. Each test owns its
// dates and clears them first; meal and food names carry a runId.

/** Log foods (150 cal each) to a day; returns their names in order. */
async function seedDay(
  db: SupabaseClient,
  date: string,
  labels: string[],
  opts: { meal?: string; servings?: number } = {},
): Promise<string[]> {
  await clearDiaryDay(db, date)
  const id = runId()
  const names: string[] = []
  for (const label of labels) {
    const food = await createFood(db, `E2E ${label} ${id}`, 150)
    await logFood(db, food, { date, ...opts })
    names.push(food.name)
  }
  return names
}

test.describe('saved meals', () => {
  test('saves selected entries as a meal', async ({ aliceDb, diaryPage: diary, page }) => {
    const day = '2025-06-01'
    const [eggs, toast] = await seedDay(aliceDb, day, ['Eggs', 'Toast'])
    const name = `E2E Usual breakfast ${runId()}`
    await diary.gotoDate(day)

    await diary.selectEntries(diary.entryRow(eggs, 150), diary.entryRow(toast, 150))
    await diary.selectionAction('Save as meal').click()
    await page.getByPlaceholder('Meal name (e.g. Usual breakfast)').fill(name)
    await page.getByRole('button', { name: 'Save meal' }).click()

    await expect.poll(() => savedMeal(aliceDb, name)).toEqual({ name, items: [eggs, toast].sort() })
  })

  test('"Save meal" stays disabled until the meal has a name', async ({ aliceDb, diaryPage: diary, page }) => {
    const day = '2025-06-02'
    const [eggs] = await seedDay(aliceDb, day, ['Eggs'])
    await diary.gotoDate(day)

    await diary.selectEntries(diary.entryRow(eggs, 150))
    await diary.selectionAction('Save as meal').click()
    const save = page.getByRole('button', { name: 'Save meal' })
    await expect(save).toBeDisabled()
    await page.getByPlaceholder('Meal name (e.g. Usual breakfast)').fill('Breakfast')
    await expect(save).toBeEnabled()
  })

  test('logs a saved meal from the picker', async ({ aliceDb, diaryPage: diary, foodPickerPage: picker }) => {
    const day = '2025-06-03'
    await clearDiaryDay(aliceDb, day)
    const id = runId()
    const oats = await createFood(aliceDb, `E2E Oats ${id}`, 150)
    const berries = await createFood(aliceDb, `E2E Berries ${id}`, 50)
    const name = `E2E Oat bowl ${id}`
    await createMeal(aliceDb, name, [oats, berries])
    await diary.gotoDate(day)
    await diary.openAddFood('Snacks')

    await picker.logSavedMeal(name, 2, 'snacks')
    await picker.doneButton.click()

    await expect(diary.entryRow(oats.name, 150)).toBeVisible()
    await expect(diary.entryRow(berries.name, 50)).toBeVisible()
  })

  test('renaming a meal shows the new name in the picker', async ({ aliceDb, diaryPage: diary, foodPickerPage: picker, page }) => {
    const id = runId()
    const oats = await createFood(aliceDb, `E2E Oats ${id}`, 150)
    const before = `E2E Brekkie ${id}`
    const after = `E2E Weekday breakfast ${id}`
    await createMeal(aliceDb, before, [oats])
    await page.goto('/meals') // Library → Meals

    page.once('dialog', (dialog) => void dialog.accept(after))
    await page.getByRole('button', { name: `Rename ${before}` }).click()

    await expect.poll(() => savedMeal(aliceDb, after)).toEqual({ name: after, items: [oats.name] })
    // Navigate inside the app: a full reload can restore the offline cache
    // from before the rename, which counts as fresh for 60 s.
    await diary.navTab('Diary').click()
    await diary.openAddFood('Snacks')
    await picker.tab('Meals').click()
    await expect(page.getByRole('button', { name: new RegExp(`^${after}`) })).toBeVisible()
  })

  test('deleting a meal keeps the entries already logged from it', async ({ aliceDb, diaryPage: diary, foodPickerPage: picker, page }) => {
    const day = '2025-06-05'
    await clearDiaryDay(aliceDb, day)
    const id = runId()
    const oats = await createFood(aliceDb, `E2E Oats ${id}`, 150)
    const name = `E2E Doomed meal ${id}`
    await createMeal(aliceDb, name, [oats])
    await diary.gotoDate(day)
    await diary.openAddFood('Snacks')
    await picker.logSavedMeal(name, 1, 'snacks')

    await page.goto('/meals')
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: `Delete ${name}` }).click()

    await expect(page.getByRole('button', { name: `Delete ${name}` })).toBeHidden()
    await expect.poll(() => savedMeal(aliceDb, name)).toBeNull()
    expect(await diaryDay(aliceDb, day)).toEqual([{ food_name: oats.name, meal: 'snacks', servings: 1 }])
  })
})

test.describe('copying', () => {
  test('copies selected entries to another day and jumps there', async ({ aliceDb, diaryPage: diary, page }) => {
    const [from, to] = ['2025-06-10', '2025-06-11']
    const [eggs, toast] = await seedDay(aliceDb, from, ['Eggs', 'Toast'])
    await clearDiaryDay(aliceDb, to)
    await diary.gotoDate(from)

    await diary.selectEntries(diary.entryRow(eggs, 150), diary.entryRow(toast, 150))
    await diary.selectionAction('Copy to day').click()
    await page.getByLabel('Copy to date').fill(to)
    await page.getByRole('button', { name: 'Copy', exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`date=${to}`))
    await expect(diary.entryRow(eggs, 150)).toBeVisible()
    await expect.poll(async () => (await diaryDay(aliceDb, to)).map((e) => e.food_name)).toEqual([eggs, toast].sort())
    expect(await diaryDay(aliceDb, from)).toHaveLength(2) // originals untouched
  })

  test('a copy keeps its meal and servings', async ({ aliceDb, diaryPage: diary, page }) => {
    const [from, to] = ['2025-06-12', '2025-06-13']
    const [stew] = await seedDay(aliceDb, from, ['Stew'], { meal: 'dinner', servings: 2 })
    await clearDiaryDay(aliceDb, to)
    await diary.gotoDate(from)

    await diary.selectEntries(diary.entryRow(stew, 300))
    await diary.selectionAction('Copy to day').click()
    await page.getByLabel('Copy to date').fill(to)
    await page.getByRole('button', { name: 'Copy', exact: true }).click()

    await expect.poll(() => diaryDay(aliceDb, to)).toEqual([{ food_name: stew, meal: 'dinner', servings: 2 }])
  })

  test("the picker copies a meal's entries from another day", async ({ aliceDb, diaryPage: diary, foodPickerPage: picker, page }) => {
    const [from, to] = ['2025-06-14', '2025-06-15']
    const [chips, salsa] = await seedDay(aliceDb, from, ['Chips', 'Salsa'])
    await clearDiaryDay(aliceDb, to)
    await diary.gotoDate(to)
    await diary.openAddFood('Snacks')

    await picker.copyDayButton.click()
    await picker.copyFromDate.fill(from)
    await page.getByRole('button', { name: 'Copy 2 items' }).click()

    await expect.poll(async () => (await diaryDay(aliceDb, to)).map((e) => e.food_name)).toEqual([chips, salsa].sort())
  })

  test('copying from a day with nothing in that meal copies nothing', async ({ aliceDb, diaryPage: diary, foodPickerPage: picker, page }) => {
    const [from, to] = ['2025-06-16', '2025-06-17']
    await seedDay(aliceDb, from, ['Cereal'], { meal: 'breakfast' }) // nothing in Snacks
    await clearDiaryDay(aliceDb, to)
    await diary.gotoDate(to)
    await diary.openAddFood('Snacks')

    await picker.copyDayButton.click()
    await picker.copyFromDate.fill(from)

    await expect(page.getByRole('button', { name: 'Copy 0 items' })).toBeDisabled()
    expect(await diaryDay(aliceDb, to)).toEqual([])
  })

  test('moves several selected entries to another meal at once', async ({ aliceDb, diaryPage: diary, page }) => {
    const day = '2025-06-18'
    const [eggs, toast] = await seedDay(aliceDb, day, ['Eggs', 'Toast'])
    await diary.gotoDate(day)

    await diary.selectEntries(diary.entryRow(eggs, 150), diary.entryRow(toast, 150))
    await diary.selectionAction('Move').click()
    await page.getByRole('button', { name: 'Dinner', exact: true }).click()

    await expect(diary.mealTotal('Dinner', 300)).toBeVisible()
    await expect
      .poll(async () => (await diaryDay(aliceDb, day)).map((e) => e.meal))
      .toEqual(['dinner', 'dinner'])
  })
})
