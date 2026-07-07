import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// USDA is mocked here so the barcode *reconcile* logic (OFF-primary, USDA
// fallback, transparency note, cross-check) is tested in isolation. The real
// lookupUsdaByBarcode (gtin matching, leading-zero retry) is covered in
// usda.test.ts.
vi.mock('./usda', () => ({ lookupUsdaByBarcode: vi.fn() }))

import { lookupBarcode } from './barcode'
import { lookupUsdaByBarcode, type UsdaFoodDetail } from './usda'

// lookupBarcode hits Open Food Facts via fetch; stub it so we exercise the pure
// mapping (unit conversion, kJ fallback, leading-0 retry, serving scaling).
const fetchMock = vi.fn()
const usdaMock = vi.mocked(lookupUsdaByBarcode)

function offResponse(product: Record<string, unknown> | null) {
  return {
    ok: true,
    status: 200,
    json: async () => (product ? { status: 1, product } : { status: 0 }),
  }
}
function notFound() {
  return { ok: false, status: 404, json: async () => ({}) }
}
// A USDA detail (per 100 g), as lookupUsdaByBarcode would return it.
function usdaFood(
  nutrients: Record<string, number>,
  extra: Partial<UsdaFoodDetail> = {},
): UsdaFoodDetail {
  return {
    name: 'USDA Food',
    brand: null,
    source_id: '999',
    serving_qty: 100,
    serving_unit: 'g',
    serving_grams: 100,
    nutrients,
    ...extra,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  usdaMock.mockResolvedValue(null) // USDA absent unless a test opts in
})
afterEach(() => {
  fetchMock.mockReset()
  usdaMock.mockReset()
  vi.unstubAllGlobals()
})

describe('lookupBarcode', () => {
  it('rejects a code with no digits without hitting the network', async () => {
    await expect(lookupBarcode('abc')).rejects.toThrow(/valid barcode/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps per-100g nutriments and converts grams to the field unit', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Test Food',
        nutriments: {
          'energy-kcal_100g': 200,
          proteins_100g: 10,
          sodium_100g: 0.5, // grams -> 500 mg
        },
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.kcal).toBe(200)
    expect(r.nutrients.protein).toBe(10) // g passes through
    expect(r.nutrients.sodium).toBe(500) // mg field
    expect(r.serving_unit).toBe('g')
    expect(r.serving_grams).toBe(100)
    expect(r.serving_qty).toBe(100)
  })

  it('derives kcal from kJ when the kcal field is absent', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'KJ Food',
        nutriments: { energy_100g: 418.4, proteins_100g: 5 },
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.kcal).toBeCloseTo(100, 5)
  })

  it('scales to a real serving when OFF knows its gram weight', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Served',
        serving_quantity: 30,
        nutriments: { proteins_100g: 10 },
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.serving_qty).toBe(1)
    expect(r.serving_unit).toBe('serving')
    expect(r.serving_grams).toBe(30)
    expect(r.nutrients.protein).toBeCloseTo(3, 5) // 10 * 30/100
  })

  it('drops negative nutriment values', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Neg',
        nutriments: { proteins_100g: -5, fat_100g: 8 },
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.protein).toBeUndefined()
    expect(r.nutrients.fat).toBe(8)
  })

  it('retries a 13-digit leading-0 code without the leading zero', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        offResponse({
          product_name: 'Retry',
          nutriments: { 'energy-kcal_100g': 100 },
        }),
      )
    const r = await lookupBarcode('0123456789012')
    // USDA is mocked (no fetch), so OFF is still the only network source: two
    // calls (13-digit miss, then 12-digit hit).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/123456789012.json')
    expect(r.name).toBe('Retry')
  })

  it('throws when neither source has the product', async () => {
    fetchMock.mockResolvedValue(offResponse(null))
    await expect(lookupBarcode('999')).rejects.toThrow(/no product found.*USDA/i)
  })

  it('trims the name and takes the first brand', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: '  Oreo  ',
        brands: 'Mondelez, Nabisco',
        nutriments: { 'energy-kcal_100g': 480 },
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.name).toBe('Oreo')
    expect(r.brand).toBe('Mondelez')
  })

  it('rejects a found product when neither source has nutrition', async () => {
    fetchMock.mockResolvedValue(
      offResponse({ product_name: 'No Facts', nutriments: {} }),
    )
    // Names the product so the user knows the scan matched, then points them at
    // the label scan / manual entry instead of a blank food form.
    await expect(lookupBarcode('1234567890')).rejects.toThrow(
      /"No Facts".*neither.*nutrition data/i,
    )
  })

  it('warns when a product has nutrients but no calories', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Fizzy Water',
        nutriments: { sodium_100g: 0.05 }, // 50 mg, no energy
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.sodium).toBe(50)
    expect(r.nutrients.kcal).toBeUndefined()
    expect(r.warnings.some((w) => /calories/i.test(w))).toBe(true)
  })

  // --- source transparency + USDA cross-check ---------------------------------

  it('adds a transparency note naming the source and serving basis', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Yogurt',
        serving_quantity: 170,
        nutriments: { 'energy-kcal_100g': 76.5 }, // -> 130 per 170 g
      }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.warnings.some((w) => /From Open Food Facts/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /per serving \(170 g\)/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /Double-check the serving size/.test(w))).toBe(
      true,
    )
  })

  it('falls back to USDA (per 100 g) when OFF has the barcode but no nutrition', async () => {
    fetchMock.mockResolvedValue(
      offResponse({ product_name: 'Named Only', nutriments: {} }),
    )
    usdaMock.mockResolvedValue(
      usdaFood({ kcal: 90, protein: 5 }, { name: 'USDA Named', brand: 'BrandCo' }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.kcal).toBe(90)
    expect(r.serving_unit).toBe('g') // USDA basis is per 100 g
    expect(r.name).toBe('Named Only') // OFF's cleaner name is preferred
    expect(r.warnings.some((w) => /From USDA/.test(w))).toBe(true)
  })

  it('uses USDA name/brand when OFF has no product at all', async () => {
    fetchMock.mockResolvedValue(offResponse(null))
    usdaMock.mockResolvedValue(
      usdaFood({ kcal: 120 }, { name: 'USDA Only', brand: 'BrandX' }),
    )
    const r = await lookupBarcode('1234567890')
    expect(r.name).toBe('USDA Only')
    expect(r.brand).toBe('BrandX')
    expect(r.nutrients.kcal).toBe(120)
  })

  it('flags a >15% calorie disagreement between OFF and USDA', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Mismatch',
        nutriments: { 'energy-kcal_100g': 100 },
      }),
    )
    usdaMock.mockResolvedValue(usdaFood({ kcal: 200 }))
    const r = await lookupBarcode('1234567890')
    expect(r.nutrients.kcal).toBe(100) // OFF stays primary
    expect(r.warnings.some((w) => /disagree on calories/i.test(w))).toBe(true)
  })

  it('does not flag agreement within 15%', async () => {
    fetchMock.mockResolvedValue(
      offResponse({
        product_name: 'Close',
        serving_quantity: 100,
        nutriments: { 'energy-kcal_100g': 76.5 },
      }),
    )
    usdaMock.mockResolvedValue(usdaFood({ kcal: 75 }))
    const r = await lookupBarcode('1234567890')
    expect(r.warnings.some((w) => /disagree/i.test(w))).toBe(false)
  })
})
