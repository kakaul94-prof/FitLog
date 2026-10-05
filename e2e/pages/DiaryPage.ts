import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks'

/** Diary tab: the signed-in landing page (food log + day totals). */
export class DiaryPage extends BasePage {
  protected readonly path = '/'

  readonly heading = this.page.getByRole('heading', { name: 'Diary', level: 1 })

  /** The bottom-nav tabs every signed-in page shows. */
  navTab(name: 'Diary' | 'Exercise' | 'Progress' | 'More'): Locator {
    return this.page.getByRole('link', { name, exact: true })
  }

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible()
  }

  /** A logged entry row; its accessible name is "{food name} {kcal}". */
  entryRow(foodName: string, kcal: number): Locator {
    return this.page.getByRole('button', { name: `${foodName} ${kcal}`, exact: true })
  }

  /** Open the food picker for a meal. Empty meals collapse to a "{Meal} + Add" row. */
  async openAddFood(meal: Meal): Promise<void> {
    const emptyRow = this.page.getByRole('button', { name: `${meal} + Add` })
    const addButton = this.page
      .getByRole('button', { name: new RegExp(`^${meal} \\d+ cal`) })
      .locator('..')
      .getByRole('button', { name: 'Add food' })
    // Wait out the loading skeleton: exactly one of the two variants renders.
    await expect(emptyRow.or(addButton)).toBeVisible()
    if (await emptyRow.isVisible()) await emptyRow.click()
    else await addButton.click()
  }
}
