import { expect, runId, test } from '../fixtures'
import { createFood, createRecipe, recipeFood } from '../support/data'

// Recipes are foods whose per-serving nutrients the app recomputes from the
// ingredients and the yield, and stores on the food. These check the stored
// numbers, since the diary and food search read them later.

test('builds a recipe and stores its per-serving nutrients', async ({ aliceDb, recipePage }) => {
  const id = runId()
  const flour = await createFood(aliceDb, `E2E Flour ${id}`, 400)
  const sugar = await createFood(aliceDb, `E2E Sugar ${id}`, 200)

  const recipeId = await recipePage.createNew()
  await recipePage.addIngredient(flour.name)
  await recipePage.addIngredient(sugar.name)
  await recipePage.setYield(4)
  await recipePage.setName(`E2E Cake ${id}`)

  // (400 + 200) ÷ 4 servings
  await expect
    .poll(() => recipeFood(aliceDb, recipeId))
    .toEqual({ name: `E2E Cake ${id}`, source: 'recipe', recipe_servings: 4, nutrients: expect.objectContaining({ kcal: 150 }) })
})

test('recalculates per serving when the yield or ingredients change', async ({ aliceDb, recipePage }) => {
  const id = runId()
  const flour = await createFood(aliceDb, `E2E Flour ${id}`, 400)
  const sugar = await createFood(aliceDb, `E2E Sugar ${id}`, 200)
  const bread = await createRecipe(aliceDb, `E2E Bread ${id}`, 4, [flour, sugar])
  await recipePage.open(bread.id, bread.name)

  await recipePage.setYield(2)
  await expect.poll(async () => (await recipeFood(aliceDb, bread.id))?.nutrients.kcal).toBe(300) // 600 ÷ 2

  await recipePage.removeIngredient(sugar.name)
  await expect.poll(async () => (await recipeFood(aliceDb, bread.id))?.nutrients.kcal).toBe(200) // 400 ÷ 2
})

test('logs servings of a recipe to the diary', async ({ aliceDb, diaryPage, foodPickerPage: picker }) => {
  const id = runId()
  const beans = await createFood(aliceDb, `E2E Beans ${id}`, 400)
  const beef = await createFood(aliceDb, `E2E Beef ${id}`, 800)
  const chili = await createRecipe(aliceDb, `E2E Chili ${id}`, 4, [beans, beef]) // 300 per serving

  await diaryPage.goto()
  await diaryPage.openAddFood('Snacks')
  await picker.search(chili.name)
  await picker.addFood(chili.name, 'snacks', 2)
  await picker.doneButton.click()

  await expect(diaryPage.entryRow(chili.name, 600)).toBeVisible()
})
