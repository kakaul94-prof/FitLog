// Barcode → food, in two steps:
//   1. detectBarcodeFromImage — read a UPC/EAN off a snapshot with the browser's
//      native BarcodeDetector (Chrome/Android; absent on iOS Safari/Firefox).
//   2. lookupBarcode — resolve that code to nutrition via Open Food Facts (free,
//      no API key, CORS-enabled), mapped to our per-serving nutrient schema.
// Both feed FoodFormPage, which fills the form for the user to review + save.
import { NUTRIENT_BY_KEY, scaleNutrients } from './nutrients'
import type { Nutrients, NutrientKey } from './database.types'
import { sanityCheck, type ScannedFood } from './scanLabel'

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

/** Resolve a scanned/typed barcode to a reviewable food via Open Food Facts. */
export async function lookupBarcode(rawCode: string): Promise<ScannedFood> {
  const code = rawCode.replace(/\D/g, '')
  if (!code) throw new Error('Enter a valid barcode number.')

  let product = await fetchOffProduct(code)
  // UPC-A often scans as a 13-digit EAN with a leading 0; OFF may store the
  // 12-digit form, so retry without it.
  if (!product && code.length === 13 && code.startsWith('0'))
    product = await fetchOffProduct(code.slice(1))
  if (!product)
    throw new Error(
      `No product found for barcode ${code} in Open Food Facts. Try the label scan, or enter the values manually.`,
    )

  const name = (product.product_name || product.product_name_en || '').trim()
  const brand = (product.brands || '').split(',')[0].trim() || null

  const nutr = product.nutriments ?? {}
  const per100: Nutrients = {}
  for (const offKey in OFF_TO_KEY) {
    const key = OFF_TO_KEY[offKey]
    const v = num(nutr[`${offKey}_100g`])
    if (v == null || v < 0) continue
    per100[key] = toOurUnit(v, key)
  }
  // Energy fallback: derive kcal from kJ when the kcal field is absent.
  if (per100.kcal == null) {
    const kj = num(nutr['energy_100g'])
    if (kj != null && kj > 0) per100.kcal = kj / 4.184
  }

  // OFF has the barcode but no nutrition table — common for regional/branded
  // entries a contributor only named. Don't silently open a blank food; say so
  // and point at the label scan / manual entry the source sheet already offers.
  if (Object.keys(per100).length === 0) {
    const label = name ? `"${name}"` : `barcode ${code}`
    throw new Error(
      `Found ${label} in Open Food Facts, but it has no nutrition data. Scan the nutrition label, or enter the values manually.`,
    )
  }

  // Prefer a real serving when OFF knows its gram weight; else per 100 g.
  const servingG = num(product.serving_quantity)
  const useServing = servingG != null && servingG > 0
  const nutrients = useServing ? scaleNutrients(per100, servingG / 100) : per100

  const warnings = sanityCheck(nutrients)
  if (nutrients.kcal == null)
    warnings.push(
      "Open Food Facts didn't list calories for this product — add them from the label.",
    )

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
