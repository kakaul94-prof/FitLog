import type { Nutrients, NutrientKey } from './database.types'
import { USDA_TO_KEY } from './nutrients'

const API = 'https://api.nal.usda.gov/fdc/v1'
const KEY = import.meta.env.VITE_USDA_API_KEY as string | undefined

export const isUsdaConfigured = Boolean(KEY)

export interface UsdaSearchItem {
  fdcId: number
  description: string
  brand: string | null
  dataType: string | null
}

interface RawNutrient {
  nutrientId?: number
  value?: number
  amount?: number
  nutrient?: { id?: number }
}

// FDC energy nutrient ids in kcal. Foundation Foods often omit 1008 (mapped to
// `kcal` in nutrients.ts) and only provide these Atwater variants.
const ENERGY_KCAL_FALLBACK = [2047, 2048] // Atwater General, Atwater Specific

function mapNutrients(list: RawNutrient[] | undefined): Nutrients {
  const out: Nutrients = {}
  if (!list) return out
  for (const fn of list) {
    const id = fn.nutrientId ?? fn.nutrient?.id
    const val = fn.value ?? fn.amount
    if (id == null || val == null) continue
    const key = USDA_TO_KEY[id] as NutrientKey | undefined
    if (key) out[key] = val
  }
  if (out.kcal == null) {
    for (const altId of ENERGY_KCAL_FALLBACK) {
      const fn = list.find(
        (n) =>
          (n.nutrientId ?? n.nutrient?.id) === altId &&
          (n.value ?? n.amount) != null,
      )
      if (fn) {
        out.kcal = (fn.value ?? fn.amount) as number
        break
      }
    }
  }
  return out
}

export async function searchUsdaFoods(
  query: string,
  signal?: AbortSignal,
): Promise<UsdaSearchItem[]> {
  if (!KEY) throw new Error('USDA API key not set')
  const url =
    `${API}/foods/search?api_key=${KEY}` +
    `&query=${encodeURIComponent(query)}` +
    `&pageSize=25&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`)
  const data = (await res.json()) as { foods?: Record<string, unknown>[] }
  return (data.foods ?? []).map((f) => ({
    fdcId: f.fdcId as number,
    description: (f.description as string) ?? 'Food',
    brand: ((f.brandName ?? f.brandOwner) as string) ?? null,
    dataType: (f.dataType as string) ?? null,
  }))
}

export interface UsdaFoodDetail {
  name: string
  brand: string | null
  source_id: string
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  nutrients: Nutrients // per serving (defaults to per 100 g)
}

export async function getUsdaFood(
  fdcId: number,
  signal?: AbortSignal,
): Promise<UsdaFoodDetail> {
  if (!KEY) throw new Error('USDA API key not set')
  const res = await fetch(`${API}/food/${fdcId}?api_key=${KEY}`, { signal })
  if (!res.ok) throw new Error(`USDA fetch failed (${res.status})`)
  const f = (await res.json()) as Record<string, unknown>
  return {
    name: (f.description as string) ?? 'Food',
    brand: ((f.brandName ?? f.brandOwner) as string) ?? null,
    source_id: String(fdcId),
    serving_qty: 100,
    serving_unit: 'g',
    serving_grams: 100,
    nutrients: mapNutrients(f.foodNutrients as RawNutrient[] | undefined),
  }
}
