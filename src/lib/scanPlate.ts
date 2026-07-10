import { prepareImage } from './image'
import type { Nutrients } from './database.types'

// A single food the meal-photo scanner detected. `nutrients` is FOR the shown
// portion (`grams`), not per 100 g — the review screen rescales from there.
export interface ScannedItem {
  name: string
  grams: number
  nutrients: Nutrients
}

export interface ScannedPlate {
  items: ScannedItem[]
  note: string | null // model's caveat, e.g. an assumed cooking-oil amount
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

// Keep only the four macros the model estimates; drop unnamed / zero-calorie
// rows (the model returns [] for a non-food image).
function cleanItem(raw: unknown): ScannedItem | null {
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

export async function scanPlate(file: File): Promise<ScannedPlate> {
  const image = await prepareImage(file)
  const res = await fetch('/api/scan-plate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image }),
  })
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok) {
    const msg = (data?.error as string) || 'Meal scan failed. Try again.'
    const detail = data?.detail as string | undefined
    throw new Error(detail ? `${msg} [${detail}]` : msg)
  }
  if (!data) throw new Error('Meal scan returned no data.')

  const raw = Array.isArray(data.items) ? data.items : []
  const items = raw
    .map(cleanItem)
    .filter((x): x is ScannedItem => x !== null)
  if (items.length === 0)
    throw new Error("Couldn't identify any foods. Try a clearer, well-lit photo.")

  const note =
    typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
  return { items, note }
}
