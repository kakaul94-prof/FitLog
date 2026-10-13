import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** Ask-a-trainer chat (/lift/trainer, or the sheet inside a workout) and its memory page. */
export class TrainerPage extends BasePage {
  protected readonly path = '/lift/trainer'

  readonly input = this.page.getByPlaceholder(/^Ask (about your training|between sets)…$/)
  readonly sendButton = this.page.getByRole('button', { name: 'Send', exact: true })
  readonly stopButton = this.page.getByRole('button', { name: 'Stop', exact: true })
  readonly thinking = this.page.getByLabel('Thinking')
  readonly savedToMemory = this.page.getByText('Saved to memory.')

  async ask(question: string): Promise<void> {
    await this.input.fill(question)
    await this.sendButton.click()
  }

  /** A chat bubble (yours or the trainer's) with exactly this text. */
  bubble(text: string): Locator {
    return this.page.getByText(text, { exact: true })
  }

  starter(prompt: string): Locator {
    return this.page.getByRole('button', { name: prompt, exact: true })
  }

  rememberButton(fact: string): Locator {
    return this.page.getByRole('button', { name: `Remember: ${fact}` })
  }

  // ---- memory page (/lift/trainer/memory) ----

  readonly factInput = this.page.getByPlaceholder('e.g. Left knee aches on deep squats')
  readonly addFactButton = this.page.getByRole('button', { name: 'Add fact' })

  async openMemory(): Promise<void> {
    await this.page.goto('/lift/trainer/memory')
  }

  forgetButton(fact: string): Locator {
    return this.page.getByRole('button', { name: `Forget: ${fact}` })
  }
}
