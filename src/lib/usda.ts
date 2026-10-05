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

// Exported for unit tests (the Atwater energy fallback is easy to regress).
export function mapNutrients(list: RawNutrient[] | undefined): Nutrients {
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

// Whole-food data types (Foundation, SR Legacy) carry full micronutrients;
// Branded entries are sparse and flood results, so they sort last.
export const USDA_PREVIEW_COUNT = 5 // inline lists (popup, picker) show this many
export const USDA_MAX_RESULTS = 50 // the "see all" results page shows up to this
function dataTypeRank(dataType: string | null): number {
  return dataType === 'Branded' ? 1 : 0
}

export async function searchUsdaFoods(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {},
): Promise<UsdaSearchItem[]> {
  const { signal, limit = USDA_PREVIEW_COUNT } = opts
  if (!KEY) throw new Error('USDA API key not set')
  // Require all query words (tighter matches) and fetch a wide page so the
  // re-rank below has whole foods to surface; capped to `limit` after.
  const url =
    `${API}/foods/search?api_key=${KEY}` +
    `&query=${encodeURIComponent(query)}` +
    `&requireAllWords=true` +
    `&pageSize=50&dataType=${encodeURIComponent('Foundation,SR Legacy,Branded')}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`USDA search failed (${res.status})`)
  const data = (await res.json()) as { foods?: Record<string, unknown>[] }
  const items: UsdaSearchItem[] = (data.foods ?? []).map((f) => ({
    fdcId: f.fdcId as number,
    description: (f.description as string) ?? 'Food',
    brand: ((f.brandName ?? f.brandOwner) as string) ?? null,
    dataType: (f.dataType as string) ?? null,
  }))
  // Stable sort keeps USDA's relevance order within each group; whole foods
  // rank above Branded. Then cap the list.
  items.sort((a, b) => dataTypeRank(a.dataType) - dataTypeRank(b.dataType))
  return items.slice(0, limit)
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

// Resolve a UPC/EAN to a USDA Branded food (manufacturer-submitted, per 100 g).
// Used as a second opinion / fallback alongside Open Food Facts in the barcode
// importer. Null when USDA isn't configured or there's no exact GTIN match.
// USDA stores the 12-digit UPC, so a 13-digit EAN with leading zeros won't match
// as text — we query both forms and confirm on gtinUpc (ignoring leading zeros)
// so a stray text hit on the digits can't masquerade as the product.
export async function lookupUsdaByBarcode(
  rawCode: string,
  signal?: AbortSignal,
): Promise<UsdaFoodDetail | null> {
  if (!KEY) return null
  const digits = rawCode.replace(/\D/g, '')
  const stripped = digits.replace(/^0+/, '')
  if (!stripped) return null
  const queries = stripped === digits ? [digits] : [digits, stripped]
  for (const q of queries) {
    const url =
      `${API}/foods/search?api_key=${KEY}` +
      `&query=${encodeURIComponent(q)}&dataType=Branded&pageSize=5`
    let res: Response
    try {
      res = await fetch(url, { signal })
    } catch {
      return null // network/USDA hiccup — never let it break the scan
    }
    if (!res.ok) continue
    const data = (await res.json().catch(() => null)) as {
      foods?: Array<{ fdcId?: number; gtinUpc?: string }>
    } | null
    const hit = (data?.foods ?? []).find(
      (food) =>
        typeof food.gtinUpc === 'string' &&
        food.gtinUpc.replace(/^0+/, '') === stripped &&
        food.fdcId != null,
    )
    if (hit?.fdcId != null) return getUsdaFood(hit.fdcId, signal)
  }
  return null
}
