import type { Food, NutrientKey, Nutrients, Portion } from './database.types'

export type NutrientGroup =
  | 'energy'
  | 'macro'
  | 'carb_sub'
  | 'fat_sub'
  | 'mineral'
  | 'vitamin'
  | 'other'

export interface NutrientDef {
  key: NutrientKey
  label: string
  unit: string // display unit
  dv: number | null // FDA Daily Value (adult), null if none
  group: NutrientGroup
  usda: number // USDA FoodData Central nutrient number (for import)
}

// Daily Values per FDA (adults & children 4+). Used for "% DV" displays.
export const NUTRIENTS: NutrientDef[] = [
  { key: 'kcal', label: 'Calories', unit: '', dv: null, group: 'energy', usda: 1008 },
  { key: 'protein', label: 'Protein', unit: 'g', dv: 50, group: 'macro', usda: 1003 },
  { key: 'carb', label: 'Carbs', unit: 'g', dv: 275, group: 'macro', usda: 1005 },
  { key: 'fat', label: 'Fat', unit: 'g', dv: 78, group: 'macro', usda: 1004 },
  { key: 'fiber', label: 'Fiber', unit: 'g', dv: 28, group: 'carb_sub', usda: 1079 },
  { key: 'sugar', label: 'Total Sugars', unit: 'g', dv: null, group: 'carb_sub', usda: 2000 },
  { key: 'added_sugar', label: 'Added Sugars', unit: 'g', dv: 50, group: 'carb_sub', usda: 1235 },
  { key: 'sat_fat', label: 'Saturated Fat', unit: 'g', dv: 20, group: 'fat_sub', usda: 1258 },
  { key: 'trans_fat', label: 'Trans Fat', unit: 'g', dv: null, group: 'fat_sub', usda: 1257 },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', dv: 300, group: 'other', usda: 1253 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dv: 2300, group: 'mineral', usda: 1093 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dv: 4700, group: 'mineral', usda: 1092 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dv: 1300, group: 'mineral', usda: 1087 },
  { key: 'iron', label: 'Iron', unit: 'mg', dv: 18, group: 'mineral', usda: 1089 },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', dv: 420, group: 'mineral', usda: 1090 },
  { key: 'phosphorus', label: 'Phosphorus', unit: 'mg', dv: 1250, group: 'mineral', usda: 1091 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', dv: 11, group: 'mineral', usda: 1095 },
  { key: 'copper', label: 'Copper', unit: 'mg', dv: 0.9, group: 'mineral', usda: 1098 },
  { key: 'manganese', label: 'Manganese', unit: 'mg', dv: 2.3, group: 'mineral', usda: 1101 },
  { key: 'selenium', label: 'Selenium', unit: 'mcg', dv: 55, group: 'mineral', usda: 1103 },
  { key: 'vit_a', label: 'Vitamin A', unit: 'mcg', dv: 900, group: 'vitamin', usda: 1106 },
  { key: 'vit_c', label: 'Vitamin C', unit: 'mg', dv: 90, group: 'vitamin', usda: 1162 },
  { key: 'vit_d', label: 'Vitamin D', unit: 'mcg', dv: 20, group: 'vitamin', usda: 1114 },
  { key: 'vit_e', label: 'Vitamin E', unit: 'mg', dv: 15, group: 'vitamin', usda: 1109 },
  { key: 'vit_k', label: 'Vitamin K', unit: 'mcg', dv: 120, group: 'vitamin', usda: 1185 },
  { key: 'b1', label: 'Thiamin (B1)', unit: 'mg', dv: 1.2, group: 'vitamin', usda: 1165 },
  { key: 'b2', label: 'Riboflavin (B2)', unit: 'mg', dv: 1.3, group: 'vitamin', usda: 1166 },
  { key: 'b3', label: 'Niacin (B3)', unit: 'mg', dv: 16, group: 'vitamin', usda: 1167 },
  { key: 'b6', label: 'Vitamin B6', unit: 'mg', dv: 1.7, group: 'vitamin', usda: 1175 },
  { key: 'folate', label: 'Folate', unit: 'mcg', dv: 400, group: 'vitamin', usda: 1190 },
  { key: 'b12', label: 'Vitamin B12', unit: 'mcg', dv: 2.4, group: 'vitamin', usda: 1178 },
]

export const NUTRIENT_BY_KEY = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
) as Record<NutrientKey, NutrientDef>

// USDA nutrient number -> our key, for import mapping.
export const USDA_TO_KEY = Object.fromEntries(
  NUTRIENTS.map((n) => [n.usda, n.key]),
) as Record<number, NutrientKey>

/** Scale a per-serving nutrient set by a multiplier (e.g. servings). */
export function scaleNutrients(n: Nutrients, factor: number): Nutrients {
  const out: Nutrients = {}
  for (const k in n) {
    const key = k as NutrientKey
    const v = n[key]
    if (typeof v === 'number') out[key] = v * factor
  }
  return out
}

/** Round every nutrient amount to the nearest whole number. */
export function roundNutrients(n: Nutrients): Nutrients {
  const out: Nutrients = {}
  for (const k in n) {
    const key = k as NutrientKey
    const v = n[key]
    if (typeof v === 'number') out[key] = Math.round(v)
  }
  return out
}

/** Sum any number of nutrient sets into one. */
export function sumNutrients(sets: Nutrients[]): Nutrients {
  const out: Nutrients = {}
  for (const set of sets) {
    for (const k in set) {
      const key = k as NutrientKey
      const v = set[key]
      if (typeof v === 'number') out[key] = (out[key] ?? 0) + v
    }
  }
  return out
}

/**
 * Display a nutrient amount as text, always rounded to the nearest whole number.
 * A trace amount (e.g. 0.4 mg) shows as "0"; "—"/no-data is decided by the
 * caller, so the two stay distinct.
 */
export function formatNutrient(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n))
}

/** Known mass units → grams (exact). Volume/count units aren't here. */
export const MASS_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  mg: 0.001,
  kg: 1000,
  oz: 28.349523,
  ounce: 28.349523,
  ounces: 28.349523,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
}

/** Grams for one of `label` if it's a known mass unit, else null. */
export function massUnitToGrams(label: string): number | null {
  return MASS_UNIT_GRAMS[label.trim().toLowerCase()] ?? null
}

/** Per-gram nutrients for a serving, or null when its gram weight is unknown. */
export function perGram(
  nutrients: Nutrients,
  servingGrams: number | null,
): Nutrients | null {
  if (!servingGrams || servingGrams <= 0) return null
  return scaleNutrients(nutrients, 1 / servingGrams)
}

/**
 * Nutrients for one of a portion. Uses the portion's own facts when overridden,
 * otherwise auto-scales the base by grams. Null when neither is possible.
 */
export function computePortionNutrients(
  baseNutrients: Nutrients,
  baseGrams: number | null,
  portion: Pick<Portion, 'grams' | 'nutrients'>,
): Nutrients | null {
  if (portion.nutrients && Object.keys(portion.nutrients).length > 0)
    return portion.nutrients
  const pg = perGram(baseNutrients, baseGrams)
  if (!pg || portion.grams == null || portion.grams <= 0) return null
  return scaleNutrients(pg, portion.grams)
}

export interface ServingOption {
  id: string // 'base' or a portion id
  label: string
  qty: number // base serving qty for this option (portions are per 1)
  nutrients: Nutrients // per `qty label`
}

/** Selectable units for logging a food: its base serving + any usable portions. */
export function servingOptions(food: Food): ServingOption[] {
  const opts: ServingOption[] = [
    {
      id: 'base',
      label: food.serving_unit,
      qty: food.serving_qty,
      nutrients: food.nutrients,
    },
  ]
  for (const p of food.portions ?? []) {
    if (!p.label.trim()) continue
    const n = computePortionNutrients(food.nutrients, food.serving_grams, p)
    if (n) opts.push({ id: p.id, label: p.label, qty: 1, nutrients: n })
  }
  return opts
}

// A selectable measure for a recipe ingredient. `nutrients` are per ONE of
// `unit`; `grams` is the gram weight of one unit (null when unknown, e.g. a
// count-based portion). `unit` is what's stored on recipe_ingredients.unit.
export interface IngredientUnit {
  unit: string // 'base' | a portion id | a mass unit ('g' | 'oz' | 'lb')
  label: string
  nutrients: Nutrients
  grams: number | null
}

// Mass units offered for any ingredient whose serving gram-weight is known.
const INGREDIENT_MASS_UNITS = ['g', 'oz', 'lb'] as const

/**
 * Measures a recipe ingredient can be entered in: the food's base serving, any
 * of its portions, plus g/oz/lb when the base serving's gram weight is known.
 * Mirrors `servingOptions` but adds mass units (recipes let you weigh things).
 */
export function ingredientUnits(food: Food): IngredientUnit[] {
  const units: IngredientUnit[] = [
    {
      unit: 'base',
      label:
        food.serving_qty === 1
          ? food.serving_unit
          : `${food.serving_qty} ${food.serving_unit}`,
      nutrients: food.nutrients,
      grams: food.serving_grams,
    },
  ]
  for (const p of food.portions ?? []) {
    if (!p.label.trim()) continue
    const n = computePortionNutrients(food.nutrients, food.serving_grams, p)
    if (n) units.push({ unit: p.id, label: p.label, nutrients: n, grams: p.grams })
  }
  const pg = perGram(food.nutrients, food.serving_grams)
  if (pg) {
    const baseUnit = food.serving_unit.trim().toLowerCase()
    for (const u of INGREDIENT_MASS_UNITS) {
      if (u === baseUnit) continue // base serving already is this mass unit
      const grams = MASS_UNIT_GRAMS[u]
      units.push({ unit: u, label: u, nutrients: scaleNutrients(pg, grams), grams })
    }
  }
  return units
}

/** The chosen measure for an ingredient, falling back to the base serving. */
export function resolveIngredientUnit(food: Food, unit: string): IngredientUnit {
  const units = ingredientUnits(food)
  return units.find((u) => u.unit === unit) ?? units[0]
}

/** Nutrients for `amount` of `unit` of an ingredient food. */
export function ingredientNutrients(
  food: Food,
  amount: number,
  unit: string,
): Nutrients {
  return scaleNutrients(resolveIngredientUnit(food, unit).nutrients, amount)
}

/**
 * Base-serving multiplier equivalent to `amount unit`, stored on
 * recipe_ingredients.servings for backward-compat. Derived from gram weights
 * when known, else the raw amount.
 */
export function ingredientServings(
  food: Food,
  amount: number,
  unit: string,
): number {
  const u = resolveIngredientUnit(food, unit)
  if (u.grams != null && food.serving_grams && food.serving_grams > 0)
    return (amount * u.grams) / food.serving_grams
  return amount
}
