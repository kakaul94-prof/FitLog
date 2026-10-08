import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

type Macro = 'Protein' | 'Fat' | 'Carbs'

/** Profile (/profile): details, calorie goal, macro targets, password. One Save for the form. */
export class ProfileSettingsPage extends BasePage {
  protected readonly path = '/profile'

  readonly sexSelect = this.page.getByLabel('Sex', { exact: true })
  readonly birthDateInput = this.page.getByLabel('Birth date')
  readonly heightFeetInput = this.page.getByLabel('Height (feet)')
  readonly heightInchesInput = this.page.getByLabel('Height (inches)')
  readonly activitySelect = this.page.getByLabel('Activity level')
  readonly weightInput = this.page.getByLabel('Current weight (lb)')
  readonly weeklyGoalSelect = this.page.getByLabel('Weekly goal')
  readonly goalWeightInput = this.page.getByLabel('Goal weight (lb, optional)')
  readonly manualToggle = this.page.getByRole('checkbox', { name: 'Set my calorie target manually' })
  readonly manualTargetInput = this.page.getByLabel('Manual calorie target')
  /** "From your data": the goal estimated from logged intake and weight change. */
  readonly adaptiveButton = this.page.getByRole('button', { name: /^Set my goal to [\d,]+ calories$/ })
  readonly saveButton = this.page.getByRole('button', { name: /^(Save|Saving…|Saved ✓)$/ })
  readonly newPasswordInput = this.page.getByLabel('New password')
  readonly confirmPasswordInput = this.page.getByLabel('Confirm password')
  readonly updatePasswordButton = this.page.getByRole('button', { name: /^(Update password|Password updated ✓)$/ })

  /** Open the page and wait for the saved profile to fill the form (it resets the fields on load). */
  async open(expectManualTarget = '2000'): Promise<void> {
    await this.goto()
    await expect(this.manualTargetInput).toHaveValue(expectManualTarget)
  }

  async save(): Promise<void> {
    await this.saveButton.click()
    await expect(this.page.getByRole('button', { name: 'Saved ✓' })).toBeVisible()
  }

  macroType(macro: Macro): Locator {
    return this.page.getByLabel(`${macro} target type`)
  }

  macroAmount(macro: Macro): Locator {
    return this.page.getByLabel(`${macro} amount`)
  }

  /** The resolved target shown under a macro, e.g. "150 g · 30%". */
  macroTarget(text: string): Locator {
    return this.page.getByText(text, { exact: true })
  }
}
