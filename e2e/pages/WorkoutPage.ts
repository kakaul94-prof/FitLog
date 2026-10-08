import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** Exercise tab (/strength) plus the live workout page it opens. */
export class WorkoutPage extends BasePage {
  protected readonly path = '/strength'

  readonly startEmptyButton = this.page.getByRole('button', { name: 'Start empty workout' })
  readonly addExerciseButton = this.page.getByRole('button', { name: 'Add exercise' })
  readonly markDoneButton = this.page.getByRole('button', { name: 'Mark as done' })

  /** The "Next up" card's template name (the card's only level-2 heading). */
  nextUp(templateName: string): Locator {
    return this.page.getByRole('heading', { level: 2, name: templateName, exact: true })
  }

  /** Train the Next up template the way a user does: start it, log a set, mark it done. */
  async trainNextUp(): Promise<void> {
    await this.page.getByRole('button', { name: 'Start workout', exact: true }).click()
    await expect(this.page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
    await this.logSet(1, 135, 5)
    await this.markDone()
  }

  async startEmptyWorkout(): Promise<void> {
    await this.startEmptyButton.click()
    await expect(this.page).toHaveURL(/\/workout\/[0-9a-f-]+$/)
  }

  /** Create a custom exercise from the picker and add it to the workout. */
  async addCustomExercise(name: string): Promise<void> {
    await this.addExerciseButton.click()
    await this.page.getByRole('button', { name: 'New custom exercise' }).click()
    await this.page.getByLabel('Name', { exact: true }).fill(name)
    await this.page.getByRole('button', { name: 'Add to workout' }).click()
    await expect(this.page.getByText(name).first()).toBeVisible()
  }

  /**
   * Fill a set row. The set inputs have no labels, so they're addressed by
   * position: each row renders a (weight, reps) pair of number inputs.
   * Inputs save on blur, and "Mark as done" discards a workout whose sets
   * haven't saved yet, so wait for the e1RM badge, which renders from the
   * saved set, before moving on.
   */
  async logSet(setNumber: number, weightLb: number, reps: number): Promise<void> {
    const inputs = this.page.getByRole('spinbutton')
    await inputs.nth((setNumber - 1) * 2).fill(String(weightLb))
    const repsInput = inputs.nth((setNumber - 1) * 2 + 1)
    await repsInput.fill(String(reps))
    await repsInput.blur()
    await expect(this.page.getByText(/^e1RM \d+/).first()).toBeVisible()
  }

  async markDone(): Promise<void> {
    await this.markDoneButton.click()
    await expect(this.page).toHaveURL(/\/strength$/)
  }
}
