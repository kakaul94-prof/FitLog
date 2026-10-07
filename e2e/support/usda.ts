import { expect, type Page, type Route } from '@playwright/test'

/** A food the fake USDA API knows about (search result + detail). */
export interface UsdaFood {
  fdcId: number
  description: string
  dataType?: string
  brandOwner?: string
  /** Per 100 g, like the real API. */
  kcal: number
  protein?: number
}

// FoodData Central nutrient ids the app maps (src/lib/nutrients.ts).
const NUTRIENT_IDS = { kcal: 1008, protein: 1003 } as const

// Cross-origin: the app at localhost calls api.nal.usda.gov, so a fulfilled
// response still needs CORS headers for the browser to hand it to fetch().
const CORS = { 'Access-Control-Allow-Origin': '*' }

/**
 * Stands in for the USDA FoodData Central API. The E2E app is built with a
 * dummy USDA key (playwright.config.ts) so the USDA UI shows, and this answers
 * every request to api.nal.usda.gov, so the real API is never called (no
 * network flakiness, rate limits or real key). A USDA request the test didn't
 * set up fails that test.
 */
export class UsdaStub {
  /** The `query` of every search request, in order. */
  readonly searches: string[] = []
  private foods: UsdaFood[] | null = null
  private failStatus: number | null = null
  private readonly unexpected: string[] = []

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    await this.page.route('https://api.nal.usda.gov/**', (route) => this.handle(route))
  }

  /** Answer searches with these foods (none = "no matches") and serve their details. */
  returns(...foods: UsdaFood[]): void {
    this.foods = foods
    this.failStatus = null
  }

  /** Answer every request with this HTTP error status. */
  failsWith(status: number): void {
    this.failStatus = status
  }

  expectNoUnexpectedCalls(): void {
    expect(this.unexpected, 'USDA requests the test did not stub').toEqual([])
  }

  private async handle(route: Route): Promise<void> {
    const url = new URL(route.request().url())
    if (this.failStatus) {
      return route.fulfill({ status: this.failStatus, headers: CORS, json: { error: 'stubbed failure' } })
    }
    if (this.foods && url.pathname.endsWith('/foods/search')) {
      this.searches.push(url.searchParams.get('query') ?? '')
      const foods = this.foods.map(({ fdcId, description, dataType = 'Foundation', brandOwner }) => ({
        fdcId,
        description,
        dataType,
        brandOwner,
      }))
      return route.fulfill({ headers: CORS, json: { foods } })
    }
    const fdcId = Number(url.pathname.match(/\/food\/(\d+)$/)?.[1])
    const food = this.foods?.find((f) => f.fdcId === fdcId)
    if (food) {
      const foodNutrients = Object.entries(NUTRIENT_IDS)
        .filter(([key]) => food[key as keyof typeof NUTRIENT_IDS] != null)
        .map(([key, id]) => ({ nutrient: { id }, amount: food[key as keyof typeof NUTRIENT_IDS] }))
      return route.fulfill({
        headers: CORS,
        json: { fdcId, description: food.description, brandOwner: food.brandOwner, foodNutrients },
      })
    }
    this.unexpected.push(url.pathname)
    return route.fulfill({ status: 404, headers: CORS, json: {} })
  }
}
