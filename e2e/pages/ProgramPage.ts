import { expect, type Locator } from '@playwright/test'
import { startsWith } from '../support/text'
import { BasePage } from './BasePage'

/** The workout rotation (/program), plus browsing and switching ready-made programs. */
export class ProgramPage extends BasePage {
  protected readonly path = '/program'

  /** A slot in the rotation, found by its options button ("Options for Upper A"). */
  slotOptions(name: string): Locator {
    return this.page.getByRole('button', { name: `Options for ${name}` })
  }

  /** Pin a template as next. Program edits save immediately, so wait for the profile write. */
  async setAsNext(name: string): Promise<void> {
    await this.slotOptions(name).click()
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH',
    )
    await this.page.getByRole('button', { name: 'Set as next' }).click()
    expect((await saved).ok(), 'program save failed').toBe(true)
  }

  /** Change program → preset → confirm. Back on /program means the switch is saved. */
  async choosePreset(presetName: string): Promise<void> {
    await this.goto()
    await this.page.getByRole('button', { name: /^Change program/ }).click()
    await this.page.getByRole('button', { name: startsWith(presetName) }).click()
    await this.page.getByRole('button', { name: /^(Use this program|Switch back to this program)$/ }).click()
    await this.page.getByRole('button', { name: 'Switch program' }).click()
    await expect(this.page).toHaveURL(/\/program$/)
  }
}
