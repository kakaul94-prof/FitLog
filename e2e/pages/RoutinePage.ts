import { expect, type Locator } from '@playwright/test'
import { escapeRegExp, startsWith } from '../support/text'
import { BasePage } from './BasePage'

/**
 * Workout templates: the list (/lift/templates) and the editor (/routines/:id).
 * The editor keeps a local draft: nothing is saved until "Save template", and
 * leaving with unsaved edits asks to save or discard them.
 */
export class RoutinePage extends BasePage {
  protected readonly path = '/lift/templates'

  readonly newTemplateButton = this.page.getByRole('button', { name: 'New template' })
  readonly nameInput = this.page.getByLabel('Template name')
  readonly saveButton = this.page.getByRole('button', { name: 'Save template' })
  // exact: names match as substrings by default, and "Back" would also match "Back Squat".
  readonly backButton = this.page.getByRole('button', { name: 'Back', exact: true })

  /** A template in the list; the link opens the editor. */
  templateLink(name: string): Locator {
    return this.page.getByRole('link', { name: startsWith(name) })
  }

  /** Start a workout straight from the list; resolves to the new workout's id. */
  async start(name: string): Promise<string> {
    await this.templateLink(name).locator('..').getByRole('button', { name: 'Start' }).click()
    await expect(this.page).toHaveURL(/\/workout\/[0-9a-f-]{36}$/)
    return this.page.url().split('/').at(-1)!
  }

  async open(id: string, name: string): Promise<void> {
    await this.page.goto(`/routines/${id}`)
    await expect(this.nameInput).toHaveValue(name)
  }

  async addExercise(name: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Exercise', exact: true }).click()
    await this.page.getByPlaceholder('Search exercises').fill(name)
    // Results read "Bench Press · Chest"; anchor on " ·" so "Bench Press" can't pick "Bench Press (Dumbbell)".
    // .first(): the same exercise can be listed in more than one section.
    await this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)} ·`) }).first().click()
    await expect(this.targetSets(name)).toBeVisible()
  }

  targetSets(exercise: string): Locator {
    return this.page.getByLabel(`${exercise} target sets`)
  }

  /** Targets commit to the draft on blur. */
  async setTargets(exercise: string, sets: number, reps: number): Promise<void> {
    await this.targetSets(exercise).fill(String(sets))
    const repsInput = this.page.getByLabel(`${exercise} target reps`)
    await repsInput.fill(String(reps))
    await repsInput.blur()
  }

  async save(): Promise<void> {
    await this.saveButton.click()
    await expect(this.page).toHaveURL(/\/strength$/)
  }

  /** Leave with unsaved edits via the back arrow, answering the save/discard prompt. */
  async leave(choice: 'Save changes' | 'Discard changes'): Promise<void> {
    await this.backButton.click()
    await this.page.getByRole('button', { name: choice }).click()
    await expect(this.page).toHaveURL(/\/strength$/)
  }
}
