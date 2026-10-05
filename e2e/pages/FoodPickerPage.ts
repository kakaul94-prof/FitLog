import { expect } from '@playwright/test'
import { BasePage } from './BasePage'

/** The "Add to {meal}" food picker (/diary/add). */
export class FoodPickerPage extends BasePage {
  protected readonly path = '/diary/add'

  readonly quickAddButton = this.page.getByRole('button', { name: 'Quick add' })
  readonly doneButton = this.page.getByRole('button', { name: 'Done', exact: true })

  /** Log a calories-only entry through the Quick add sheet. */
  async quickAdd(meal: string, name: string, kcal: number): Promise<void> {
    await this.quickAddButton.click()
    await expect(this.page.getByText(`Quick add to ${meal}`)).toBeVisible()
    await this.page.getByLabel('Name (optional)').fill(name)
    await this.page.getByLabel('Calories', { exact: true }).fill(String(kcal))
    await this.page.getByRole('button', { name: `Add to ${meal}` }).click()
  }
}
