import type { Nutrients } from './database.types'

// One ingredient parsed from a recipe link. `nutrients` are FOR `grams` (not per
// 100 g) — the import stores each ingredient as a 1-serving food weighing `grams`.
export interface ImportedIngredient {
  name: string
  grams: number
  nutrients: Nutrients
}

export interface ImportedRecipe {
  name: string
  servings: number
  ingredients: ImportedIngredient[]
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

// Keep the four macros the model estimates; drop unnamed / zero-calorie rows.
function cleanIngredient(raw: unknown): ImportedIngredient | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const kcal = num(r.kcal)
  if (!name || kcal <= 0) return null
  const nutrients: Nutrients = { kcal }
  const protein = num(r.protein)
  if (protein) nutrients.protein = protein
  const carb = num(r.carb)
  if (carb) nutrients.carb = carb
  const fat = num(r.fat)
  if (fat) nutrients.fat = fat
  return { name, grams: num(r.grams) || 1, nutrients }
}

export async function importRecipe(url: string): Promise<ImportedRecipe> {
  const res = await fetch('/api/import-recipe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok) {
    const msg = (data?.error as string) || 'Recipe import failed. Try again.'
    const detail = data?.detail as string | undefined
    throw new Error(detail ? `${msg} [${detail}]` : msg)
  }
  if (!data) throw new Error('Recipe import returned no data.')

  const rawList = Array.isArray(data.ingredients) ? data.ingredients : []
  const ingredients = rawList
    .map(cleanIngredient)
    .filter((x): x is ImportedIngredient => x !== null)
  if (ingredients.length === 0)
    throw new Error(
      "Couldn't find ingredients on that page. Try another link, or add it manually.",
    )

  const name =
    typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : 'Imported recipe'
  const servings = num(data.servings) || 1
  return { name, servings, ingredients }
}
