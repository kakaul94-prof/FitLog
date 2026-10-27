import type { Locator, Page } from '@playwright/test'

/**
 * The sheet "Mark as done" opens when a workout started from a template
 * differs from it (exercises, set counts, order or rest timer): update the
 * template, save a new one, or finish and leave the template alone.
 */
export class SaveTemplateSheet {
  readonly dialog: Locator

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog', { name: 'Save to template' })
  }

  /** Close the workout and keep the template exactly as it was. */
  async finishWithoutSaving(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Finish without saving' }).click()
  }
}
