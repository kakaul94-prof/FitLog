import type { Food, Nutrients } from './database.types'

// Spots library foods that look like a food about to be added from a scan
// (barcode or nutrition label), so the source sheet can warn before a
// duplicate lands in the library. Pure: the caller fetches the live library.

/** Why a library food was flagged, in confidence order. */
export type SimilarReason = 'barcode' | 'name' | 'nutrition'

export const SIMILAR_REASON_LABEL: Record<SimilarReason, string> = {
  barcode: 'Same barcode',
  name: 'Same name and brand',
  nutrition: 'Nutrition within 10%',
}

/** The slice of a library food the matcher reads. */
export type MatchableFood = Pick<
  Food,
  'id' | 'name' | 'brand' | 'source' | 'source_id' | 'serving_grams' | 'nutrients' | 'archived'
>

/** The food about to be added. `barcode` is the scanned digits; null for a label scan. */
export type ScanCandidate = {
  name: string
  brand: string | null
  barcode: string | null
  serving_grams: number | null
  nutrients: Nutrients
}

export type SimilarFood<F extends MatchableFood = MatchableFood> = {
  food: F
  reason: SimilarReason
}

export const SIMILAR_FOOD_LIMIT = 3
export const NUTRITION_TOLERANCE = 0.1

/** Digits only, without leading zeros — a UPC-A code and its EAN-13 form
 *  (one extra leading 0) then compare equal. */
export function normalizeBarcode(code: string | null | undefined): string {
  return (code ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

/** Lower-cased, accents dropped, punctuation collapsed to single spaces. */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Same name (ignoring case and punctuation) and a compatible brand: equal, or
 *  missing on either side. Two nameless foods never match. */
export function nameBrandMatch(
  a: { name: string; brand: string | null },
  b: { name: string; brand: string | null },
): boolean {
  const an = normalizeText(a.name)
  if (!an || an !== normalizeText(b.name)) return false
  const ab = normalizeText(a.brand)
  const bb = normalizeText(b.brand)
  return !ab || !bb || ab === bb
}

const MACROS = ['kcal', 'protein', 'carb', 'fat'] as const
// Absolute floors so near-zero values (0 vs 0.4 g fat) don't fail a relative test.
const FLOOR: Record<(typeof MACROS)[number], number> = {
  kcal: 5,
  protein: 0.5,
  carb: 0.5,
  fat: 0.5,
}

type NutritionSide = { serving_grams: number | null; nutrients: Nutrients }

/** Calories, protein, carbs and fat all within `tolerance` of each other.
 *  Compared per 100 g when both sides know their serving weight (a label
 *  scanned per bar vs. a copy saved per 100 g), else per serving as stored.
 *  Needs calories on both sides — a food with no kcal matches nothing. */
export function nutritionMatch(
  a: NutritionSide,
  b: NutritionSide,
  tolerance = NUTRITION_TOLERANCE,
): boolean {
  if (!a.nutrients.kcal || !b.nutrients.kcal) return false
  const perGram = (a.serving_grams ?? 0) > 0 && (b.serving_grams ?? 0) > 0
  const sa = perGram ? 100 / (a.serving_grams as number) : 1
  const sb = perGram ? 100 / (b.serving_grams as number) : 1
  return MACROS.every((k) => {
    const x = (a.nutrients[k] ?? 0) * sa
    const y = (b.nutrients[k] ?? 0) * sb
    return Math.abs(x - y) <= Math.max(tolerance * Math.max(x, y), FLOOR[k])
  })
}

/**
 * Library foods that look like `scan`, most confident first: the same barcode
 * (only foods saved from a scan carry one — USDA ids share the column), then
 * the same name and brand, then near-identical nutrition. Each food is listed
 * once under its strongest reason; archived foods are skipped.
 */
export function findSimilarFoods<F extends MatchableFood>(
  scan: ScanCandidate,
  library: readonly F[],
  limit = SIMILAR_FOOD_LIMIT,
): SimilarFood<F>[] {
  const live = library.filter((f) => !f.archived)
  const out: SimilarFood<F>[] = []
  const seen = new Set<string>()
  const add = (food: F, reason: SimilarReason) => {
    if (seen.has(food.id)) return
    seen.add(food.id)
    out.push({ food, reason })
  }

  const code = normalizeBarcode(scan.barcode)
  if (code)
    for (const f of live)
      if (f.source === 'manual' && normalizeBarcode(f.source_id) === code)
        add(f, 'barcode')
  for (const f of live) if (nameBrandMatch(scan, f)) add(f, 'name')
  for (const f of live) if (nutritionMatch(scan, f)) add(f, 'nutrition')

  return out.slice(0, limit)
}
