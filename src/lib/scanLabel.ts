import { NUTRIENT_KEYS } from './database.types'
import type { Nutrients } from './database.types'
import { prepareImage } from './image'

export interface ScannedFood {
  name: string
  brand: string | null
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  nutrients: Nutrients
  warnings: string[]
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function cleanNutrients(input: unknown): Nutrients {
  const out: Nutrients = {}
  if (!input || typeof input !== 'object') return out
  const rec = input as Record<string, unknown>
  for (const k of NUTRIENT_KEYS) {
    const v = rec[k]
    const n = typeof v === 'string' ? parseFloat(v) : v
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n
  }
  return out
}

// Cheap post-checks that catch the common misreads; shown to the user.
// Shared with the barcode importer (lib/barcode.ts).
export function sanityCheck(n: Nutrients): string[] {
  const w: string[] = []
  const { kcal, protein, carb, fat } = n
  if (kcal != null && kcal > 0 && protein != null && carb != null && fat != null) {
    const est = 4 * protein + 4 * carb + 9 * fat
    if (Math.abs(est - kcal) > Math.max(50, kcal * 0.3)) {
      w.push(
        `Calories (${Math.round(kcal)}) don't match the macros (≈${Math.round(
          est,
        )} expected). Double-check the values.`,
      )
    }
  }
  return w
}

export async function scanLabel(file: File): Promise<ScannedFood> {
  const image = await prepareImage(file)
  const res = await fetch('/api/scan-label', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image }),
  })
  const data = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok) {
    const msg = (data?.error as string) || 'Label scan failed. Try again.'
    const detail = data?.detail as string | undefined
    throw new Error(detail ? `${msg} [${detail}]` : msg)
  }
  if (!data) throw new Error('Label scan returned no data.')

  const nutrients = cleanNutrients(data.nutrients)
  return {
    name: str(data.name),
    brand: str(data.brand) || null,
    serving_qty: numOrNull(data.serving_qty) ?? 1,
    serving_unit: str(data.serving_unit) || 'serving',
    serving_grams: numOrNull(data.serving_grams),
    nutrients,
    warnings: sanityCheck(nutrients),
  }
}
