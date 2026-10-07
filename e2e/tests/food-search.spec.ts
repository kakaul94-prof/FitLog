import { expect, runId, test } from '../fixtures'
import type { DiaryPage } from '../pages/DiaryPage'
import { signedInClient } from '../support/api'
import { createFood, diaryEntries, logFood } from '../support/data'
import { USERS } from '../support/env'

// Food search on the "Add to Snacks" picker: the user's own library, the Recent
// tab, multi-add, and importing from USDA (always stubbed, see support/usda.ts).
// Each test creates its own uniquely named foods through the API first, then
// does the journey under test through the UI.

async function openPicker(diaryPage: DiaryPage): Promise<void> {
  await diaryPage.goto()
  await diaryPage.openAddFood('Snacks')
}

test.describe('library search', () => {
  test('finds a saved food by a partial, mixed-case name', async ({ aliceDb, diaryPage, foodPickerPage: picker }) => {
    const id = runId()
    const yogurt = await createFood(aliceDb, `E2E Greek Yogurt ${id}`, 120)
    const banana = await createFood(aliceDb, `E2E Banana ${id}`, 105)
    await openPicker(diaryPage)

    await picker.search(`gREEK yog`)

    await expect(picker.foodRow(yogurt.name)).toBeVisible()
    await expect(picker.foodRow(banana.name)).toBeHidden()
  })

  test('shows the empty state when nothing matches', async ({ diaryPage, foodPickerPage: picker }) => {
    await openPicker(diaryPage)

    await picker.search(`no-such-food-${runId()}`)

    await expect(picker.emptyState).toBeVisible()
  })

  test('adds a searched food with 2 servings and saves a nutrient snapshot', async ({
    aliceDb,
    diaryPage,
    foodPickerPage: picker,
  }) => {
    const oats = await createFood(aliceDb, `E2E Oats ${runId()}`, 150)
    await openPicker(diaryPage)

    await picker.search(oats.name)
    await picker.addFood(oats.name, 'snacks', 2)
    await picker.doneButton.click()

    await expect(diaryPage.entryRow(oats.name, 300)).toBeVisible()
    // Stored per serving (150) × 2 servings, linked to the library food.
    expect(await diaryEntries(aliceDb, oats.name)).toEqual([
      { meal: 'snacks', servings: 2, food_id: oats.id, nutrients: expect.objectContaining({ kcal: 150 }) },
    ])
  })

  test("never shows another user's foods", async ({ aliceDb, diaryPage, foodPickerPage: picker }) => {
    const id = runId()
    const bob = await signedInClient(USERS.bob)
    const alices = await createFood(aliceDb, `E2E Pantry ${id} (Alice)`, 100)
    const bobs = await createFood(bob, `E2E Pantry ${id} (Bob)`, 100)
    await openPicker(diaryPage)

    await picker.search(`Pantry ${id}`)

    // Alice's food showing proves the results are in; only then is "Bob's is
    // hidden" meaningful. The RLS specs don't cover the foods table.
    await expect(picker.foodRow(alices.name)).toBeVisible()
    await expect(picker.foodRow(bobs.name)).toBeHidden()
  })
})

test.describe('adding', () => {
  test('multi-adds two foods at once', async ({ aliceDb, diaryPage, foodPickerPage: picker }) => {
    const id = runId()
    const rice = await createFood(aliceDb, `E2E Rice ${id}`, 200)
    const beans = await createFood(aliceDb, `E2E Beans ${id}`, 110)
    await openPicker(diaryPage)

    await picker.search(id)
    await picker.multiAddButton.click()
    await picker.foodRow(rice.name).click()
    await picker.foodRow(beans.name).click()
    await picker.addPicked(2, 'snacks')
    await picker.doneButton.click()

    await expect(diaryPage.entryRow(rice.name, 200)).toBeVisible()
    await expect(diaryPage.entryRow(beans.name, 110)).toBeVisible()
  })

  test('the Recent tab lists logged foods and search filters within it', async ({
    aliceDb,
    diaryPage,
    foodPickerPage: picker,
  }) => {
    const id = runId()
    const kiwi = await createFood(aliceDb, `E2E Kiwi ${id}`, 42)
    const plum = await createFood(aliceDb, `E2E Plum ${id}`, 30)
    await logFood(aliceDb, kiwi)
    await logFood(aliceDb, plum)
    await openPicker(diaryPage)

    await picker.tab('Recent').click()
    await expect(picker.foodRow(kiwi.name)).toBeVisible()
    await expect(picker.foodRow(plum.name)).toBeVisible()

    await picker.search(kiwi.name)
    await expect(picker.foodRow(kiwi.name)).toBeVisible()
    await expect(picker.foodRow(plum.name)).toBeHidden()
  })

  test('a logged entry keeps its calories when the food is edited later', async ({
    aliceDb,
    diaryPage,
    foodPickerPage: picker,
    page,
  }) => {
    const soup = await createFood(aliceDb, `E2E Soup ${runId()}`, 250)
    await openPicker(diaryPage)
    await picker.search(soup.name)
    await picker.addFood(soup.name, 'snacks')

    const { error } = await aliceDb.from('foods').update({ nutrients: { kcal: 999 } }).eq('id', soup.id)
    expect(error).toBeNull()
    await picker.doneButton.click()
    await page.reload()

    // The diary stores a snapshot, so past days never change when a food does.
    await expect(diaryPage.entryRow(soup.name, 250)).toBeVisible()
    expect(await diaryEntries(aliceDb, soup.name)).toEqual([
      expect.objectContaining({ nutrients: expect.objectContaining({ kcal: 250 }) }),
    ])
  })
})

test.describe('USDA search (stubbed)', () => {
  test('imports a USDA food into the library and logs it', async ({ aliceDb, diaryPage, foodPickerPage: picker, usda }) => {
    const id = runId()
    // A unique fdcId per run, so a rerun never matches a food imported earlier.
    const apple = { fdcId: Date.now() % 1e9, description: `E2E Apple raw ${id}`, kcal: 52, protein: 0.3 }
    usda.returns(apple, { fdcId: apple.fdcId + 1, description: `E2E Apple juice ${id}`, dataType: 'Branded', brandOwner: 'Test Farms', kcal: 46 })
    await openPicker(diaryPage)

    await picker.search(`apple ${id}`)
    await picker.usdaSearchButton.click()
    await picker.usdaResult(apple.description).click()
    await picker.addFromSheet(apple.description, 'snacks')

    expect(usda.searches).toEqual([`apple ${id}`])
    // Saved to the library as a USDA food, per 100 g like the source data.
    const { data: imported } = await aliceDb
      .from('foods')
      .select('source, source_id, serving_qty, serving_unit, nutrients')
      .eq('name', apple.description)
    expect(imported).toEqual([
      {
        source: 'usda',
        source_id: String(apple.fdcId),
        serving_qty: 100,
        serving_unit: 'g',
        nutrients: expect.objectContaining({ kcal: 52, protein: 0.3 }),
      },
    ])
    await picker.doneButton.click()
    await expect(diaryPage.entryRow(apple.description, 52)).toBeVisible()
  })

  test('shows a message when USDA has no matches', async ({ diaryPage, foodPickerPage: picker, usda }) => {
    const term = `qwerty ${runId()}`
    usda.returns()
    await openPicker(diaryPage)

    await picker.search(term)
    await picker.usdaSearchButton.click()

    await expect(picker.message(`No USDA matches for "${term}".`)).toBeVisible()
  })

  test('a USDA outage shows an error and library search keeps working', async ({
    aliceDb,
    diaryPage,
    foodPickerPage: picker,
    usda,
  }) => {
    const id = runId()
    const bread = await createFood(aliceDb, `E2E Bread ${id}`, 80)
    usda.failsWith(500)
    await openPicker(diaryPage)

    await picker.search(`rye ${id}`)
    await picker.usdaSearchButton.click()
    await expect(picker.message('USDA search failed (500)')).toBeVisible()

    await picker.search(bread.name)
    await expect(picker.foodRow(bread.name)).toBeVisible()
  })
})
