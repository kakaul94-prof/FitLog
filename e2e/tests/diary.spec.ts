import { test, expect, runId } from '../fixtures'

test('logs a meal with Quick add and it is saved to the diary', async ({
  diaryPage,
  foodPickerPage,
  aliceDb,
}) => {
  const food = `E2E snack ${runId()}`
  const kcal = 321

  await diaryPage.goto()
  await diaryPage.openAddFood('Snacks')
  await foodPickerPage.quickAdd('snacks', food, kcal)
  await foodPickerPage.doneButton.click()

  // The UI shows it...
  await diaryPage.expectLoaded()
  await expect(diaryPage.entryRow(food, kcal)).toBeVisible()

  // ...and the row really reached Postgres, owned by Alice, in the right meal.
  await expect
    .poll(async () => {
      const { data } = await aliceDb
        .from('diary_entries')
        .select('meal, nutrients')
        .eq('food_name', food)
      return data
    })
    .toEqual([{ meal: 'snacks', nutrients: expect.objectContaining({ kcal }) }])
})
