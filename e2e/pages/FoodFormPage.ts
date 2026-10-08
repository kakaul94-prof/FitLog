import type { Locator } from '@playwright/test'
import { BasePage } from './BasePage'

/**
 * The New / Edit food form (/foods/new, /foods/:id). Nutrition is entered per
 * serving; changing the serving size rescales it when the field loses focus.
 */
export class FoodFormPage extends BasePage {
  protected readonly path = '/foods/new'

  readonly nameInput = this.page.getByLabel('Name', { exact: true })
  readonly brandInput = this.page.getByLabel('Brand (optional)')
  readonly servingSizeInput = this.page.getByLabel('Serving size')
  readonly unitInput = this.page.getByLabel('Unit', { exact: true })
  readonly servingGramsInput = this.page.getByLabel('Weight per serving (g)')
  readonly micronutrientsToggle = this.page.getByRole('button', { name: 'Micronutrients (optional)' })
  readonly addUnitButton = this.page.getByRole('button', { name: 'Add a unit' })
  readonly saveButton = this.page.getByRole('button', { name: /^(Save to my foods|Save & add to recipe|Save)$/ })

  /** "Enter manually" on the New food sheet (the other choices are USDA and scanning). */
  readonly enterManually = this.page.getByRole('button', { name: 'Enter manually' })

  /** A nutrient's input by its label: "Calories", "Protein", "Sodium"… */
  nutrient(label: string): Locator {
    return this.page.getByLabel(label, { exact: true })
  }

  async fill(fields: {
    name?: string
    brand?: string
    servingSize?: number
    unit?: string
    servingGrams?: number
    nutrients?: Record<string, number>
  }): Promise<void> {
    if (fields.name != null) await this.nameInput.fill(fields.name)
    if (fields.brand != null) await this.brandInput.fill(fields.brand)
    if (fields.servingSize != null) await this.servingSizeInput.fill(String(fields.servingSize))
    if (fields.unit != null) await this.unitInput.fill(fields.unit)
    if (fields.servingGrams != null) await this.servingGramsInput.fill(String(fields.servingGrams))
    for (const [label, value] of Object.entries(fields.nutrients ?? {})) {
      await this.nutrient(label).fill(String(value))
    }
  }

  /** Add an extra serving unit, e.g. "slice" = 30 g. */
  async addUnit(label: string, grams: number): Promise<void> {
    await this.addUnitButton.click()
    await this.page.getByPlaceholder('cup, oz, slice…').last().fill(label)
    await this.page.getByPlaceholder('grams').last().fill(String(grams))
  }
}
