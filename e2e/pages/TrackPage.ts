import { expect, type Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/** The GPS recorder (/exercise/track), preset to Walking. */
export class TrackPage extends BasePage {
  protected readonly path = '/exercise/track?activity=walking'

  readonly startButton = this.page.getByRole('button', { name: 'Start', exact: true })
  readonly pauseButton = this.page.getByRole('button', { name: 'Pause', exact: true })
  readonly resumeButton = this.page.getByRole('button', { name: 'Resume', exact: true })
  readonly stopButton = this.page.getByRole('button', { name: 'Stop', exact: true })

  /** The live distance readout, e.g. "0.50" (miles, 2 dp). */
  distance(miles: string): Locator {
    return this.page.getByText(miles, { exact: true })
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true })
  }

  /** Stop and land on the review screen; returns what the recorder handed over. */
  async stop(): Promise<URLSearchParams> {
    await this.stopButton.click()
    await expect(this.page).toHaveURL(/\/exercise\/add\?/)
    return new URL(this.page.url()).searchParams
  }
}
