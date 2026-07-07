// Barcode → food, in two steps:
//   1. detectBarcodeFromImage — read a UPC/EAN off a snapshot with the browser's
//      native BarcodeDetector (Chrome/Android; absent on iOS Safari/Firefox).
//   2. lookupBarcode — resolve that code to nutrition, cross-referencing two
//      sources: Open Food Facts (free, no key, CORS, international, carries a
//      serving size) and USDA Branded (manufacturer-submitted, US-centric, per
//      100 g). Crowd-sourced records are often wrong, so we name the source used
//      and flag disagreements rather than trusting one number silently.
// Both feed FoodFormPage, which fills the form for the user to review + save.
import { NUTRIENT_BY_KEY, scaleNutrients } from './nutrients'
import type { Nutrients, NutrientKey } from './database.types'
import { sanityCheck, type ScannedFood } from './scanLabel'
import { lookupUsdaByBarcode } from './usda'

// --- Barcode detection (camera snapshot) ----------------------------------

// BarcodeDetector isn't in TS's DOM lib yet; declare the slice we use.
type BarcodeDetectorInstance = {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: {
      formats?: string[]
    }) => BarcodeDetectorInstance
  }
}

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']

export function isBarcodeDetectionSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

/** Read the first product barcode in a photo. Null = none found. */
export async function detectBarcodeFromImage(file: File): Promise<string | null> {
  const BD = window.BarcodeDetector
  if (!BD)
    throw new Error(
      "This browser can't read barcodes from a photo. Type the barcode digits instead.",
    )
  let detector: BarcodeDetectorInstance
  try {
    detector = new BD({ formats: BARCODE_FORMATS })
  } catch {
    detector = new BD() // some impls reject the formats list; detect all
  }
  // Full resolution detects far better than a downscale, and it's all on-device.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const results = await detector.detect(bitmap)
    return results[0]?.rawValue?.trim() || null
  } finally {
    bitmap.close()
  }
}

// --- Open Food Facts lookup -----------------------------------------------

const OFF_API = 'https://world.openfoodfacts.org/api/v2/product'
const OFF_FIELDS =
  'code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments'

// OFF nutriment key -> our key. OFF normalizes every `*_100g` to grams; the one
// exception is energy, exposed in kcal under `energy-kcal`.
const OFF_TO_KEY: Record<string, NutrientKey> = {
  'energy-kcal': 'kcal',
  proteins: 'protein',
  carbohydrates: 'carb',
  fat: 'fat',
  fiber: 'fiber',
  sugars: 'sugar',
  'added-sugars': 'added_sugar',
  'saturated-fat': 'sat_fat',
  'trans-fat': 'trans_fat',
  cholesterol: 'cholesterol',
  sodium: 'sodium',
  potassium: 'potassium',
  calcium: 'calcium',
  iron: 'iron',
  magnesium: 'magnesium',
  phosphorus: 'phosphorus',
  zinc: 'zinc',
  copper: 'copper',
  manganese: 'manganese',
  selenium: 'selenium',
  'vitamin-a': 'vit_a',
  'vitamin-c': 'vit_c',
  'vitamin-d': 'vit_d',
  'vitamin-e': 'vit_e',
  'vitamin-k': 'vit_k',
  'vitamin-b1': 'b1',
  'vitamin-b2': 'b2',
  'vitamin-pp': 'b3',
  'vitamin-b6': 'b6',
  'vitamin-b9': 'folate',
  'vitamin-b12': 'b12',
}

interface OffProduct {
  product_name?: string
  product_name_en?: string
  brands?: string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, unknown>
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// OFF stores grams; convert to the field's display unit (kcal/g pass through).
function toOurUnit(value: number, key: NutrientKey): number {
  const unit = NUTRIENT_BY_KEY[key].unit
  if (unit === 'mg') return value * 1000
  if (unit === 'mcg') return value * 1_000_000
  return value
}

async function fetchOffProduct(code: string): Promise<OffProduct | null> {
  const res = await fetch(
    `${OFF_API}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`,
  )
  if (res.status === 404) return null
  if (!res.ok)
    throw new Error(`Barcode lookup failed (${res.status}). Check your connection.`)
  const data = (await res.json().catch(() => null)) as {
    status?: number
    product?: OffProduct
  } | null
  if (!data || data.status === 0 || !data.product) return null
  return data.product
}

// Map OFF's per-100 g nutriments into our schema (grams → display unit), with a
// kJ→kcal energy fallback when the kcal field is missing.
function offNutrients(nutr: Record<string, unknown>): Nutrients {
  const per100: Nutrients = {}
  for (const offKey in OFF_TO_KEY) {
    const key = OFF_TO_KEY[offKey]
    const v = num(nutr[`${offKey}_100g`])
    if (v == null || v < 0) continue
    per100[key] = toOurUnit(v, key)
  }
  if (per100.kcal == null) {
    const kj = num(nutr['energy_100g'])
    if (kj != null && kj > 0) per100.kcal = kj / 4.184
  }
  return per100
}

function offName(p: OffProduct | null): string {
  return p ? (p.product_name || p.product_name_en || '').trim() : ''
}
function offBrand(p: OffProduct | null): string | null {
  return p ? (p.brands || '').split(',')[0].trim() || null : null
}

// UPC-A often scans as a 13-digit EAN with a leading 0; OFF may store the
// 12-digit form, so retry without it.
async function fetchOffWithRetry(code: string): Promise<OffProduct | null> {
  const product = await fetchOffProduct(code)
  if (!product && code.length === 13 && code.startsWith('0'))
    return fetchOffProduct(code.slice(1))
  return product
}

/**
 * Resolve a scanned/typed barcode to a reviewable food, cross-referencing Open
 * Food Facts and USDA. OFF is primary when it carries nutrition (it usually has
 * a real serving size); USDA fills in when OFF doesn't, and cross-checks the
 * calories when both do. The returned `warnings` name the source and flag any
 * disagreement so a bad crowd-sourced record can't slip through unnoticed.
 */
export async function lookupBarcode(rawCode: string): Promise<ScannedFood> {
  const code = rawCode.replace(/\D/g, '')
  if (!code) throw new Error('Enter a valid barcode number.')

  // Query both sources in parallel; a USDA hiccup must never break the scan.
  const [product, usda] = await Promise.all([
    fetchOffWithRetry(code),
    lookupUsdaByBarcode(code).catch(() => null),
  ])

  const offPer100 = product ? offNutrients(product.nutriments ?? {}) : {}
  const usdaPer100 = usda?.nutrients ?? {}
  const offHasNutrition = Object.keys(offPer100).length > 0
  const usdaHasNutrition = Object.keys(usdaPer100).length > 0

  if (!product && !usda)
    throw new Error(
      `No product found for barcode ${code} in Open Food Facts or USDA. Try the label scan, or enter the values manually.`,
    )

  const name = offName(product) || usda?.name || ''
  const brand = offBrand(product) ?? usda?.brand ?? null

  // Found the barcode, but neither source has a nutrition table — don't open a
  // blank food; point at the label scan / manual entry instead.
  if (!offHasNutrition && !usdaHasNutrition) {
    const label = name ? `"${name}"` : `barcode ${code}`
    throw new Error(
      `Found ${label}, but neither Open Food Facts nor USDA has nutrition data for it. Scan the nutrition label, or enter the values manually.`,
    )
  }

  // OFF is primary when it has nutrition; otherwise use USDA (per 100 g — its
  // label serving units are unreliable, so let the user set the portion).
  const useOff = offHasNutrition
  const source = useOff ? 'Open Food Facts' : 'USDA'
  const per100 = useOff ? offPer100 : usdaPer100
  const servingG = useOff && product ? num(product.serving_quantity) : null
  const useServing = servingG != null && servingG > 0
  const nutrients = useServing ? scaleNutrients(per100, servingG / 100) : per100

  const warnings = sanityCheck(nutrients)

  // (1) Transparency: name the source and the exact basis, and nudge a check —
  // per-serving calories swing with whatever serving size a record picked.
  if (nutrients.kcal != null) {
    const basis = useServing ? `per serving (${Math.round(servingG)} g)` : 'per 100 g'
    warnings.push(
      `From ${source}: ${Math.round(nutrients.kcal)} kcal ${basis}. Double-check the serving size matches your package.`,
    )
  } else {
    warnings.push(
      `${source} didn't list calories for this product — add them from the label.`,
    )
  }

  // (2) Cross-check: both sources carry per-100 g energy — if they disagree by
  // more than ~15%, the record you scanned may be mis-entered.
  const dOff = offPer100.kcal
  const dUsda = usdaPer100.kcal
  if (dOff != null && dUsda != null && dOff > 0 && dUsda > 0) {
    if (Math.abs(dOff - dUsda) / Math.max(dOff, dUsda) > 0.15)
      warnings.push(
        `Sources disagree on calories: Open Food Facts ${Math.round(dOff)} vs USDA ${Math.round(dUsda)} kcal/100 g. Verify against your package.`,
      )
  }

  return {
    name,
    brand,
    serving_qty: useServing ? 1 : 100,
    serving_unit: useServing ? 'serving' : 'g',
    serving_grams: useServing ? servingG : 100,
    nutrients,
    warnings,
  }
}
