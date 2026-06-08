import { NUTRIENT_KEYS } from './database.types'
import type { Nutrients } from './database.types'

export interface ScannedFood {
  name: string
  brand: string | null
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  nutrients: Nutrients
  warnings: string[]
}

const MAX_DIM = 1500

// Downscale + re-encode on-device: smaller upload, EXIF auto-oriented, JPEG.
async function prepareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image processing not supported on this device.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('Could not process the image.')
  return arrayBufferToBase64(await blob.arrayBuffer())
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
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
function sanityCheck(n: Nutrients): string[] {
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
  if (!res.ok)
    throw new Error((data?.error as string) || 'Label scan failed. Try again.')
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
