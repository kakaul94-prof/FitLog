import { expect } from '@playwright/test'
import { BasePage } from './BasePage'

/** Signed-out landing view: the email + password sign-in form. */
export class LoginPage extends BasePage {
  protected readonly path = '/'

  readonly emailInput = this.page.getByLabel('Email')
  readonly passwordInput = this.page.getByLabel('Password')
  readonly signInButton = this.page.getByRole('button', { name: 'Sign in', exact: true })
  // The form's inline error paragraph (no role/testid in the app).
  readonly errorMessage = this.page.locator('form p.text-destructive')

  async signIn(email: string, password: string): Promise<void> {
    await expect(this.signInButton).toBeVisible()
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.signInButton.click()
  }
}
