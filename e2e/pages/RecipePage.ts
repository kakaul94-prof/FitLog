import { expect, type Locator } from '@playwright/test'
import { startsWith } from '../support/text'
import { BasePage } from './BasePage'

/**
 * Library → Recipes and the recipe editor (/recipes/:id). Edits save on blur,
 * and after every save the editor re-syncs its fields from the server. So each
 * action waits until its save shows on screen before the next edit; otherwise a
 * late re-sync can overwrite a value that's still being typed.
 */
export class RecipePage extends BasePage {
  protected readonly path = '/recipes'

  readonly newRecipeButton = this.page.getByRole('button', { name: 'New recipe' })
  readonly nameInput = this.page.getByLabel('Name', { exact: true })
  readonly yieldInput = this.page.getByLabel('Yield (servings)')
  readonly addIngredientButton = this.page.getByRole('button', { name: 'Add ingredient' })
  readonly ingredientSearch = this.page.getByPlaceholder('Search your foods')

  /** Create a recipe from the library and return its id once the editor has loaded it. */
  async createNew(): Promise<string> {
    await this.goto()
    await this.newRecipeButton.click()
    await expect(this.page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/)
    await expect(this.nameInput).toHaveValue('New recipe')
    return this.page.url().split('/').at(-1)!
  }

  async open(id: string, name: string): Promise<void> {
    await this.page.goto(`/recipes/${id}`)
    await expect(this.nameInput).toHaveValue(name)
  }

  perServingHeading(servings: number): Locator {
    return this.page.getByRole('heading', { name: `Per serving (makes ${servings})` })
  }

  /** The ingredient's row (its remove button carries the food name). */
  ingredient(foodName: string): Locator {
    return this.page.getByRole('button', { name: `Remove ${foodName}` })
  }

  async setName(name: string): Promise<void> {
    await this.nameInput.fill(name)
    await this.nameInput.blur()
  }

  async setYield(servings: number): Promise<void> {
    await this.yieldInput.fill(String(servings))
    await this.yieldInput.blur()
    await expect(this.perServingHeading(servings)).toBeVisible()
  }

  /** Add 1 serving of a library food; done once its row is on screen (saved and reloaded). */
  async addIngredient(foodName: string): Promise<void> {
    await this.addIngredientButton.click()
    const results = this.page.waitForResponse((r) => r.url().includes('/rest/v1/foods') && r.url().includes('ilike'))
    await this.ingredientSearch.fill(foodName)
    await results
    await this.page.getByRole('button', { name: startsWith(foodName) }).click()
    await expect(this.ingredient(foodName)).toBeVisible()
  }

  async removeIngredient(foodName: string): Promise<void> {
    await this.ingredient(foodName).click()
    await expect(this.ingredient(foodName)).toBeHidden()
  }
}
