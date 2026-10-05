import { getUsdaFood } from './usda'
import { roundNutrients } from './nutrients'
import type { Food, Nutrients, Portion } from './database.types'

// A food pre-filled from a source, handed to the food form via router state.
export type FoodDraft = {
  name: string
  brand: string
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  source: Food['source']
  source_id: string | null
  nutrients: Nutrients
  portions: Portion[]
  warnings?: string[]
}

// Fetch a USDA food (per 100 g) and shape it into a draft for the food form.
// Shared by the source sheet's inline pick and the full "see all" page.
export async function buildUsdaDraft(
  fdcId: number,
  signal?: AbortSignal,
): Promise<FoodDraft> {
  const d = await getUsdaFood(fdcId, signal)
  return {
    name: d.name,
    brand: d.brand ?? '',
    serving_qty: d.serving_qty,
    serving_unit: d.serving_unit,
    serving_grams: d.serving_grams ?? null,
    source: 'usda',
    source_id: d.source_id,
    nutrients: roundNutrients(d.nutrients),
    portions: [],
  }
}
