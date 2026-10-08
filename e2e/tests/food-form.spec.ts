import { expect, runId, test } from '../fixtures'
import { clearDiaryDay, createFood, createRecipe, diaryLinks, foodByName, logFood, recipeFood } from '../support/data'

// The New / Edit food form, as Alice. Foods carry a runId so names never
// collide; tests that log to the diary each own one date and clear it first.

test('creates a food from the picker and logs it', async ({ aliceDb, diaryPage: diary, foodPickerPage: picker, foodFormPage: form }) => {
  const day = '2025-05-01'
  const name = `E2E Granola ${runId()}`
  await clearDiaryDay(aliceDb, day)
  await diary.gotoDate(day)
  await diary.openAddFood('Snacks')

  await picker.newFoodButton.click()
  await form.enterManually.click()
  await form.fill({
    name,
    brand: 'Test Mill',
    servingSize: 1,
    unit: 'cup',
    servingGrams: 240,
    nutrients: { Calories: 300, Protein: 10, Carbs: 50, Fat: 6 },
  })
  await form.saveButton.click()

  // Back in the picker with the new food already picked: one tap to log it.
  await picker.addPicked(1, 'snacks')
  await picker.doneButton.click()
  await expect(diary.entryRow(name, 300)).toBeVisible()
  expect(await foodByName(aliceDb, name)).toMatchObject({
    brand: 'Test Mill',
    serving_qty: 1,
    serving_unit: 'cup',
    serving_grams: 240,
    nutrients: { kcal: 300, protein: 10, carb: 50, fat: 6 },
  })
})

test('Save stays disabled until the food has a name', async ({ foodFormPage: form }) => {
  await form.goto()
  await expect(form.saveButton).toBeDisabled()

  await form.nameInput.fill(`E2E Unnamed ${runId()}`)
  await expect(form.saveButton).toBeEnabled()
})

test('changing the serving size rescales the nutrition', async ({ aliceDb, foodFormPage: form, page }) => {
  const name = `E2E Apple ${runId()}`
  await form.goto()
  await form.fill({ name, servingSize: 100, unit: 'g', servingGrams: 100, nutrients: { Calories: 52, Protein: 10 } })

  await form.servingSizeInput.fill('150')
  await form.servingSizeInput.blur()

  await expect(form.nutrient('Calories')).toHaveValue('78') // 52 × 1.5
  await expect(form.nutrient('Protein')).toHaveValue('15')
  await expect(form.servingGramsInput).toHaveValue('150')
  await form.saveButton.click()
  await expect(page).toHaveURL(/\/foods$/)
  expect(await foodByName(aliceDb, name)).toMatchObject({
    serving_qty: 150,
    serving_grams: 150,
    nutrients: { kcal: 78, protein: 15 },
  })
})

test('a blank nutrient is stored as unknown and shown as "—", not 0', async ({ aliceDb, foodFormPage: form, diaryPage: diary, page }) => {
  const day = '2025-05-04'
  const name = `E2E Mystery bar ${runId()}`
  await clearDiaryDay(aliceDb, day)
  await form.goto()
  await form.fill({ name, nutrients: { Calories: 200, Protein: 5 } }) // carbs left blank
  await form.saveButton.click()
  await expect(page).toHaveURL(/\/foods$/)

  const food = await foodByName(aliceDb, name)
  expect(food!.nutrients).toEqual({ kcal: 200, protein: 5 })
  await logFood(aliceDb, { id: food!.id, name, nutrients: food!.nutrients }, { date: day }) // the app's own snapshot
  await diary.gotoDate(day)
  await diary.entryRow(name, 200).click()
  await expect(page.getByText('Carbs', { exact: true }).locator('..')).toContainText('—')
})

test('an extra serving unit logs by its own weight', async ({ aliceDb, foodFormPage: form, diaryPage: diary, foodPickerPage: picker, page }) => {
  const day = '2025-05-05'
  const name = `E2E Sourdough ${runId()}`
  await clearDiaryDay(aliceDb, day)
  await form.goto()
  await form.fill({ name, servingSize: 100, unit: 'g', servingGrams: 100, nutrients: { Calories: 250 } })
  await form.addUnit('slice', 30)
  await form.saveButton.click()
  await expect(page).toHaveURL(/\/foods$/)

  await diary.gotoDate(day)
  await diary.openAddFood('Snacks')
  await picker.search(name)
  await picker.foodRow(name).click()
  const unit = page.getByLabel('Serving unit')
  await unit.selectOption((await unit.locator('option', { hasText: 'slice' }).getAttribute('value'))!)
  await picker.addFromSheet(name, 'snacks', 2)
  await picker.doneButton.click()

  await expect(diary.entryRow(name, 150)).toBeVisible() // 2 × 30 g at 250 cal per 100 g
})

test('micronutrients are saved and shown with their % Daily Value', async ({ aliceDb, foodFormPage: form, diaryPage: diary, page }) => {
  const day = '2025-05-06'
  const name = `E2E Broth ${runId()}`
  await clearDiaryDay(aliceDb, day)
  await form.goto()
  await form.fill({ name, nutrients: { Calories: 15 } })
  await form.micronutrientsToggle.click()
  await form.nutrient('Sodium').fill('460')
  await form.saveButton.click()
  await expect(page).toHaveURL(/\/foods$/)

  const food = await foodByName(aliceDb, name)
  expect(food!.nutrients).toMatchObject({ kcal: 15, sodium: 460 })
  await logFood(aliceDb, { id: food!.id, name, nutrients: food!.nutrients }, { date: day })
  await diary.gotoDate(day)
  await diary.entryRow(name, 15).click()
  const sodium = page.getByText('Sodium', { exact: true }).locator('..')
  await expect(sodium).toContainText('460 mg')
  await expect(sodium).toContainText('20%') // of the 2,300 mg Daily Value
})

test('editing a food changes it from now on; past diary entries keep their numbers', async ({
  aliceDb,
  foodFormPage: form,
  diaryPage: diary,
  foodPickerPage: picker,
  page,
}) => {
  const day = '2025-05-07'
  await clearDiaryDay(aliceDb, day)
  const yogurt = await createFood(aliceDb, `E2E Yogurt ${runId()}`, 250)
  await logFood(aliceDb, yogurt, { date: day })

  await page.goto('/foods') // Library → Foods
  await page.getByPlaceholder('Search your foods').fill(yogurt.name)
  await page.getByRole('link', { name: yogurt.name }).click()
  await expect(form.nameInput).toHaveValue(yogurt.name)
  await form.nutrient('Calories').fill('300')
  await form.saveButton.click()
  await expect(page).toHaveURL(/\/foods$/)

  await diary.gotoDate(day)
  await expect(diary.entryRow(yogurt.name, 250)).toBeVisible()
  await diary.openAddFood('Snacks')
  await picker.search(yogurt.name)
  await expect(picker.foodRow(yogurt.name)).toContainText('300 calories')
})

test('deleting a food hides it from search; past diary entries keep their link', async ({
  aliceDb,
  diaryPage: diary,
  foodPickerPage: picker,
  page,
}) => {
  const day = '2025-05-08'
  await clearDiaryDay(aliceDb, day)
  const muffin = await createFood(aliceDb, `E2E Muffin ${runId()}`, 400)
  await logFood(aliceDb, muffin, { date: day })
  await diary.gotoDate(day)
  await diary.openAddFood('Snacks')
  await picker.search(muffin.name)

  await picker.openFoodMenu(muffin.name)
  await page.getByRole('button', { name: 'Delete food' }).click()

  await expect(picker.foodRow(muffin.name)).toBeHidden()
  // A soft delete: the food is archived, not removed, so anything that points
  // at it (past diary entries, recipes) keeps working.
  await expect.poll(async () => (await foodByName(aliceDb, muffin.name))?.archived).toBe(true)
  expect(await diaryLinks(aliceDb, day)).toEqual([{ food_name: muffin.name, food_id: muffin.id }])
})

test('creates a food from Library → Foods', async ({ foodFormPage: form, page }) => {
  const name = `E2E Hummus ${runId()}`
  await page.goto('/foods')
  await page.getByRole('button', { name: 'New food' }).click()
  await form.enterManually.click()
  await form.fill({ name, nutrients: { Calories: 70 } })
  await form.saveButton.click()

  await expect(page).toHaveURL(/\/foods$/)
  await page.getByPlaceholder('Search your foods').fill(name)
  await expect(page.getByRole('link', { name })).toBeVisible()
})

test('a food created from the recipe editor becomes an ingredient', async ({ aliceDb, recipePage, foodFormPage: form, page }) => {
  const id = runId()
  const rice = await createFood(aliceDb, `E2E Rice ${id}`, 400)
  const bowl = await createRecipe(aliceDb, `E2E Bowl ${id}`, 2, [rice]) // 200 per serving
  const sauce = `E2E Sauce ${id}`
  await recipePage.open(bowl.id, bowl.name)

  await recipePage.addIngredientButton.click()
  await page.getByRole('button', { name: 'Create a new food' }).click()
  await form.enterManually.click()
  await form.fill({ name: sauce, nutrients: { Calories: 200 } })
  await form.saveButton.click() // "Save & add to recipe"

  await expect(page).toHaveURL(new RegExp(`/recipes/${bowl.id}$`))
  await expect(recipePage.ingredient(sauce)).toBeVisible()
  await expect.poll(async () => (await recipeFood(aliceDb, bowl.id))?.nutrients.kcal).toBe(300) // (400 + 200) ÷ 2
})
