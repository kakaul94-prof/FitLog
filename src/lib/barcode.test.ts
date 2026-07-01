import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupBarcode } from './barcode'

// lookupBarcode hits Open Food Facts via fetch; stub it so we exercise the
// pure mapping (unit conversion, kJ fallback, leading-0 retry, serving scaling).
const fetchMock = vi.fn()

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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('lookupBarcode', () => {
  it('rejects a code with no digits without hitting the network', async () => {
    await expect(lookupBarcode('abc')).rejects.toThrow(/valid barcode/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps per-100g nutriments and converts grams to the field unit', () => {
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
    return lookupBarcode('1234567890').then((r) => {
      expect(r.nutrients.kcal).toBe(200)
      expect(r.nutrients.protein).toBe(10) // g passes through
      expect(r.nutrients.sodium).toBe(500) // mg field
      expect(r.serving_unit).toBe('g')
      expect(r.serving_grams).toBe(100)
      expect(r.serving_qty).toBe(100)
    })
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
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('/123456789012.json')
    expect(r.name).toBe('Retry')
  })

  it('throws a helpful error when no product is found', async () => {
    fetchMock.mockResolvedValue(offResponse(null))
    await expect(lookupBarcode('999')).rejects.toThrow(/no product found/i)
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

  it('rejects a found product that has no nutrition data', async () => {
    fetchMock.mockResolvedValue(
      offResponse({ product_name: 'No Facts', nutriments: {} }),
    )
    // Names the product so the user knows the scan matched, then points them
    // at the label scan / manual entry instead of a blank food form.
    await expect(lookupBarcode('1234567890')).rejects.toThrow(
      /"No Facts".*no nutrition data/i,
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
})
