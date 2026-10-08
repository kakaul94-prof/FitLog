import { expect, type Locator } from '@playwright/test'
import { startsWith } from '../support/text'
import { BasePage } from './BasePage'

/**
 * Logging cardio (/exercise/add, and /exercise/edit/:id) plus the diary's
 * exercise rows and calorie ring for a given day.
 */
export class CardioPage extends BasePage {
  protected readonly path = '/exercise/add'

  readonly searchBox = this.page.getByPlaceholder('Search activities (e.g. mowing)')
  readonly durationTile = this.page.getByRole('button', { name: /Duration$/ })
  readonly durationInput = this.page.getByLabel('Duration (min)')
  readonly distanceTile = this.page.getByRole('button', { name: /Distance$/ })
  readonly distanceInput = this.page.getByLabel('Distance (mi, optional)')
  readonly caloriesInput = this.page.getByLabel('Calories', { exact: true })
  readonly saveButton = this.page.getByRole('button', { name: /^(Add exercise|Save changes)$/ })

  /** Open the add screen for a day, from that day's diary (saving goes back to it). */
  async openFor(date: string): Promise<void> {
    await this.page.goto(`/?date=${date}`)
    await this.page.goto(`/exercise/add?date=${date}`)
  }

  /** The big calorie figure ("336 cal"); tapping it lets you type your own. */
  calories(kcal: number): Locator {
    return this.page.getByRole('button', { name: `${kcal} cal`, exact: true })
  }

  async pickActivity(name: string): Promise<void> {
    await this.searchBox.fill(name.split(' (')[0])
    // .first(): an activity can show under "Recent" as well as in the results.
    await this.page.getByRole('button', { name: startsWith(name) }).first().click()
    await expect(this.durationInput).toBeVisible() // picking opens the duration tile
  }

  /**
   * Picking an activity opens the duration tile by itself; when editing it
   * starts closed. Wait until the tiles are on screen before checking, or the
   * check can run mid-save and the click then closes the tile the app just
   * opened. (The tiles render before the duration input, so .first() is the tile.)
   */
  async setDuration(minutes: number): Promise<void> {
    await expect(this.durationTile.or(this.durationInput).first()).toBeVisible()
    if (!(await this.durationInput.isVisible())) await this.durationTile.click()
    await this.durationInput.fill(String(minutes))
  }

  async setDistance(miles: number): Promise<void> {
    await this.distanceTile.click()
    await this.distanceInput.fill(String(miles))
  }

  async overrideCalories(current: number, kcal: number): Promise<void> {
    await this.calories(current).click()
    await this.caloriesInput.fill(String(kcal))
    await this.caloriesInput.blur()
  }

  /** Save; the screen then returns to the diary it was opened from. */
  async save(): Promise<void> {
    await this.saveButton.click()
    await expect(this.page).toHaveURL(/\/\?date=|\/$/)
  }

  // ---- the diary for that day ----

  /** An exercise row on the diary ("Cycling … 30 min 336"). */
  diaryRow(name: string): Locator {
    return this.page.getByRole('button', { name: startsWith(name) })
  }

  /** The calorie ring's label: "N calories remaining" (goal + exercise − food). */
  remaining(kcal: number): Locator {
    return this.page.getByLabel(`${kcal} calories remaining`, { exact: true })
  }

  /** Press and hold a row to open its menu, then delete. Waits for the menu, not a fixed delay. */
  async deleteFromDiary(name: string): Promise<void> {
    await this.diaryRow(name).hover()
    await this.page.mouse.down()
    const deleteButton = this.page.getByRole('button', { name: 'Delete entry' })
    await expect(deleteButton).toBeVisible()
    await this.page.mouse.up()
    await deleteButton.click()
  }
}
