import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * Editing one logged food (/diary/entry/:id): servings, meal, delete. Changing
 * the meal saves at once; servings wait for "Save changes", and leaving with
 * unsaved servings asks Save / Discard changes / Keep editing.
 */
export class EntryPage extends BasePage {
  protected readonly path = '/diary/entry'

  readonly servingsInput = this.page.getByLabel('Servings', { exact: true })
  readonly mealSelect = this.page.getByLabel('Meal')
  readonly saveChangesButton = this.page.getByRole('button', { name: 'Save changes', exact: true })
  readonly deleteButton = this.page.getByRole('button', { name: 'Delete entry' })
  readonly backButton = this.page.getByRole('button', { name: 'Back', exact: true })

  /** A button on the "Save changes?" prompt shown when leaving with unsaved servings. */
  promptButton(name: 'Save' | 'Discard changes' | 'Keep editing'): Locator {
    return this.page.getByRole('button', { name, exact: true })
  }
}
