import { expect, runId, test } from '../fixtures'
import { createFood, createRecipe, recipeFood } from '../support/data'
import { refuseAll, waitForIdle } from '../support/network'

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

test.describe('a recipe save that fails partway leaves nothing behind', () => {
  // Saving a recipe takes several steps (the recipe, its ingredient foods, the
  // links between them). If a later step fails, the earlier ones are undone:
  // no empty recipe or orphaned ingredient foods are left in your library.
  test.describe.configure({ retries: 0 })

  async function foodsNamed(db: import('@supabase/supabase-js').SupabaseClient, names: string[]) {
    const { data, error } = await db.from('foods').select('name').in('name', names)
    if (error) throw new Error(`foodsNamed: ${error.message}`)
    return data
  }

  test('importing from a link', async ({ page, aliceDb, recipePage }) => {
    const id = runId()
    const recipe = { name: `E2E Imported ${id}`, servings: 2 }
    const ingredients = [
      { name: `E2E Flour ${id}`, grams: 100, kcal: 364 },
      { name: `E2E Butter ${id}`, grams: 20, kcal: 143 },
    ]
    // The link reader (a Pages Function) answers with the parsed recipe.
    await page.route('**/api/import-recipe', (route) => route.fulfill({ json: { ...recipe, ingredients } }))
    await refuseAll(page, 'recipe_ingredients', 'POST') // the third step fails
    await recipePage.goto()

    await page.getByRole('button', { name: 'Import from a link' }).click()
    await page.getByLabel('Paste a recipe URL').fill('https://example.com/bread')
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(/Injected failure|Import failed/)).toBeVisible()
    await waitForIdle(page)

    expect(await foodsNamed(aliceDb, [recipe.name, ...ingredients.map((i) => i.name)])).toEqual([])
  })

  test('saving a copy of a recipe', async ({ page, aliceDb, recipePage }) => {
    const id = runId()
    const flour = await createFood(aliceDb, `E2E Flour ${id}`, 364)
    const loaf = await createRecipe(aliceDb, `E2E Loaf ${id}`, 2, [flour])
    await recipePage.open(loaf.id, loaf.name)
    await refuseAll(page, 'recipe_ingredients', 'POST') // copying the ingredients fails

    await page.getByRole('button', { name: 'Save as a copy' }).click()
    await waitForIdle(page)

    expect(await foodsNamed(aliceDb, [`${loaf.name} (copy)`])).toEqual([])
    await expect(page).toHaveURL(new RegExp(`/recipes/${loaf.id}$`)) // still on the original
  })
})
