import type { Page } from '@playwright/test'

/**
 * Base for all page objects: holds the Playwright page and a route. Subclasses
 * expose intention-revealing locators and actions so specs read like user
 * journeys and selectors live in exactly one place.
 */
export abstract class BasePage {
  protected abstract readonly path: string

  constructor(protected readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(this.path)
  }
}
