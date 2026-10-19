import type { Locator, Page } from '@playwright/test'

/**
 * The pre-workout check-in that opens whenever a workout is started (from
 * the Lift tab, a template or the program). Every row starts as Fine, so
 * confirming it untouched starts the workout exactly as planned.
 */
export class CheckinSheet {
  readonly dialog: Locator

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Pre-workout check-in' })
  }

  /** Start without changing anything, the way most check-ins go. */
  async startWorkout(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Start workout', exact: true }).click()
  }
}
