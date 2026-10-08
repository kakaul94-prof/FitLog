import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** Progress tab (/progress): log body weight + the history list. */
export class ProgressPage extends BasePage {
  protected readonly path = '/progress'

  readonly heading = this.page.getByRole('heading', { name: 'Progress', level: 1 })
  // The visible label isn't associated with the input, so target its sibling.
  readonly weightInput = this.page.locator('label:text-is("Log weight (lb)") + input')
  readonly addButton = this.page.getByRole('button', { name: 'Add', exact: true })

  async logWeight(lb: number): Promise<void> {
    await expect(this.heading).toBeVisible()
    await this.weightInput.fill(String(lb))
    await this.addButton.click()
  }

  /** A history row's value text, e.g. "163.4 lb". */
  historyEntry(lb: number): Locator {
    return this.page.getByText(`${lb} lb`, { exact: true })
  }

  /** Move a weigh-in to another date; it saves as soon as the date changes. */
  async changeWeighInDate(lb: number, date: string): Promise<void> {
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/rest/v1/measurements') && r.request().method() === 'PATCH',
    )
    await this.page.getByLabel(`Date of ${lb} lb`).fill(date)
    expect((await saved).ok(), 'weigh-in update failed').toBe(true)
  }

  async deleteWeighIn(lb: number): Promise<void> {
    await this.page.getByRole('button', { name: `Delete ${lb} lb` }).click()
    await expect(this.historyEntry(lb)).toBeHidden()
  }
}
