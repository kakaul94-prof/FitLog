import { expect, type Locator } from '@playwright/test'
import { startsWith } from '../support/text'
import { BasePage } from './BasePage'

/** The "Add to {meal}" food picker (/diary/add). */
export class FoodPickerPage extends BasePage {
  protected readonly path = '/diary/add'

  readonly quickAddButton = this.page.getByRole('button', { name: 'Quick add' })
  readonly doneButton = this.page.getByRole('button', { name: 'Done', exact: true })
  readonly searchBox = this.page.getByPlaceholder('Search your foods')
  readonly multiAddButton = this.page.getByRole('button', { name: 'Multi-add' })
  readonly emptyState = this.page.getByText('No foods found.')
  readonly usdaSearchButton = this.page.getByRole('button', { name: /^Search USDA for/ })
  readonly servingsInput = this.page.getByLabel('Servings', { exact: true })

  /** Log a calories-only entry through the Quick add sheet. */
  async quickAdd(meal: string, name: string, kcal: number): Promise<void> {
    await this.quickAddButton.click()
    await expect(this.page.getByText(`Quick add to ${meal}`)).toBeVisible()
    await this.page.getByLabel('Name (optional)').fill(name)
    await this.page.getByLabel('Calories', { exact: true }).fill(String(kcal))
    await this.page.getByRole('button', { name: `Add to ${meal}` }).click()
  }

  /**
   * Type into the search box and wait for the library query's response, so a
   * following "is hidden" assertion checks the search results rather than the
   * loading state (which is also empty).
   */
  async search(term: string): Promise<void> {
    const results = this.page.waitForResponse(
      (r) => r.url().includes('/rest/v1/foods') && r.url().includes('ilike') && r.ok(),
    )
    await this.searchBox.fill(term)
    await results
  }

  tab(name: 'All' | 'Recent' | 'Frequent' | 'Meals'): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') })
  }

  /** A food in the list. Its accessible name starts with the food name ("Oats 150 calories · …"). */
  foodRow(name: string): Locator {
    return this.page.getByRole('button', { name: startsWith(name) })
  }

  /** A USDA search result (description, then brand / data type). */
  usdaResult(description: string): Locator {
    return this.foodRow(description)
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true })
  }

  /** Tap a food, then add it from the servings sheet. */
  async addFood(name: string, meal: string, servings?: number): Promise<void> {
    await this.foodRow(name).click()
    await this.addFromSheet(name, meal, servings)
  }

  /** Set the servings on the open servings sheet and add to the meal. */
  async addFromSheet(name: string, meal: string, servings?: number): Promise<void> {
    if (servings != null) await this.servingsInput.fill(String(servings))
    await this.addAndWaitForSave(this.page.getByRole('button', { name: `Add to ${meal}` }), `Added ${name}`)
  }

  /** Multi-add: add every picked food at once (one insert for all of them). */
  async addPicked(count: number, meal: string): Promise<void> {
    await this.addAndWaitForSave(this.page.getByRole('button', { name: `Add ${count} to ${meal}` }), `Added ${count} items`)
  }

  /**
   * The picker is optimistic: its "Added …" toast shows before the insert has
   * reached the database. So wait for the insert's response too, or the next
   * step (Done → diary, or a DB assertion) could race the write.
   */
  private async addAndWaitForSave(button: Locator, toast: string): Promise<void> {
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/rest/v1/diary_entries') && r.request().method() === 'POST',
    )
    await button.click()
    // Toast first: it shows at once but hides after 1.8 s, so checking it
    // after a slow insert could miss it.
    await expect(this.message(toast)).toBeVisible()
    expect((await saved).ok(), 'diary insert failed').toBe(true)
  }
}
