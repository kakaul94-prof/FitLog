import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** The workout rotation (/program), plus browsing and switching ready-made programs. */
export class ProgramPage extends BasePage {
  protected readonly path = '/program'

  /**
   * The rotation card's header ("Upper / lower program · 4 days"), which
   * expands it. The card starts collapsed, and the slots, their ⋮ options and
   * "Change program" only render inside it.
   */
  readonly rotationToggle = this.page
    .getByRole('button', { name: /program/ })
    .and(this.page.locator('[aria-expanded]'))

  async openRotation(): Promise<void> {
    await expect(this.rotationToggle).toBeVisible()
    if ((await this.rotationToggle.getAttribute('aria-expanded')) !== 'true') await this.rotationToggle.click()
    await expect(this.rotationToggle).toHaveAttribute('aria-expanded', 'true')
  }

  /** A slot in the rotation, found by its options button ("Options for Upper A"). */
  slotOptions(name: string): Locator {
    return this.page.getByRole('button', { name: `Options for ${name}` })
  }

  /** Pin a template as next. Program edits save immediately, so wait for the profile write. */
  async setAsNext(name: string): Promise<void> {
    await this.openRotation()
    await this.slotOptions(name).click()
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH',
    )
    await this.page.getByRole('button', { name: 'Set as next' }).click()
    expect((await saved).ok(), 'program save failed').toBe(true)
  }

  /**
   * Change program → preset → confirm. Back on /program means the switch is
   * saved; ends with the new rotation open.
   */
  async choosePreset(presetName: string): Promise<void> {
    await this.goto()
    await this.openRotation()
    await this.page.getByRole('button', { name: /^Change program/ }).click()
    // Match the preset's exact title, not a prefix: "Upper / lower" is also the
    // start of "Upper / lower / push / pull".
    await this.page
      .getByRole('button')
      .filter({ has: this.page.getByText(presetName, { exact: true }) })
      .click()
    await this.page.getByRole('button', { name: /^(Use this program|Switch back to this program)$/ }).click()
    await this.page.getByRole('button', { name: 'Switch program' }).click()
    await expect(this.page).toHaveURL(/\/program$/)
    await this.openRotation()
  }
}
