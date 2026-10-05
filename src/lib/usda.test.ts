import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupUsdaByBarcode, mapNutrients } from './usda'

// Stable FDC nutrient ids (external identifiers; see nutrients.ts `usda` field).
const PROTEIN = 1003
const KCAL = 1008
// Atwater energy variants used as the kcal fallback in usda.ts.
const ATWATER_GENERAL = 2047
const ATWATER_SPECIFIC = 2048

describe('mapNutrients', () => {
  it('returns an empty object for missing/empty input', () => {
    expect(mapNutrients(undefined)).toEqual({})
    expect(mapNutrients([])).toEqual({})
  })

  it('maps known FDC ids to our nutrient keys', () => {
    expect(mapNutrients([{ nutrientId: PROTEIN, value: 12 }])).toEqual({
      protein: 12,
    })
  })

  it('accepts the nested nutrient.id / amount shape', () => {
    expect(mapNutrients([{ nutrient: { id: PROTEIN }, amount: 7 }])).toEqual({
      protein: 7,
    })
  })

  it('skips entries with no id or no value, and unknown ids', () => {
    expect(
      mapNutrients([
        { value: 5 }, // no id
        { nutrientId: PROTEIN }, // no value
        { nutrientId: 999999, value: 5 }, // unknown id
      ]),
    ).toEqual({})
  })

  // --- Atwater energy fallback (the regression-prone bit) -------------------
  it('falls back to Atwater General (2047) when 1008 is absent', () => {
    expect(mapNutrients([{ nutrientId: ATWATER_GENERAL, value: 250 }])).toEqual({
      kcal: 250,
    })
  })

  it('falls back to Atwater Specific (2048) when 2047 is also absent', () => {
    expect(mapNutrients([{ nutrientId: ATWATER_SPECIFIC, value: 240 }])).toEqual(
      { kcal: 240 },
    )
  })

  it('prefers the real energy id (1008) over the Atwater fallback', () => {
    const out = mapNutrients([
      { nutrientId: KCAL, value: 200 },
      { nutrientId: ATWATER_GENERAL, value: 999 },
    ])
    expect(out.kcal).toBe(200)
  })

  it('prefers 2047 over 2048 when both are present', () => {
    const out = mapNutrients([
      { nutrientId: ATWATER_SPECIFIC, value: 240 },
      { nutrientId: ATWATER_GENERAL, value: 250 },
    ])
    expect(out.kcal).toBe(250)
  })
})

// lookupUsdaByBarcode hits FDC's search + food endpoints; stub fetch so we
// exercise the GTIN matching and leading-zero retry. VITE_USDA_API_KEY is set to
// a dummy in vitest.config.ts so the code path runs (real calls are mocked).
describe('lookupUsdaByBarcode', () => {
  const fetchMock = vi.fn()
  const okJson = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  })

  beforeEach(() => vi.stubGlobal('fetch', fetchMock))
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('matches a Branded food by gtinUpc and returns per-100g nutrients', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ foods: [{ fdcId: 42, gtinUpc: '036000291452' }] }),
      )
      .mockResolvedValueOnce(
        okJson({
          description: 'Soda',
          brandOwner: 'BrandCo',
          foodNutrients: [{ nutrient: { id: 1008 }, amount: 41 }],
        }),
      )
    const r = await lookupUsdaByBarcode('036000291452')
    expect(r?.name).toBe('Soda')
    expect(r?.brand).toBe('BrandCo')
    expect(r?.nutrients.kcal).toBe(41)
  })

  it('ignores a text hit whose gtinUpc does not match the code', async () => {
    fetchMock.mockResolvedValue(
      okJson({ foods: [{ fdcId: 1, gtinUpc: '999999999999' }] }),
    )
    expect(await lookupUsdaByBarcode('036000291452')).toBeNull()
  })

  it('retries the zero-stripped form for a leading-0 code', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ foods: [] })) // raw 13-digit: no hit
      .mockResolvedValueOnce(
        okJson({ foods: [{ fdcId: 7, gtinUpc: '036000291452' }] }),
      ) // stripped: hit
      .mockResolvedValueOnce(
        okJson({
          description: 'X',
          foodNutrients: [{ nutrient: { id: 1008 }, amount: 10 }],
        }),
      )
    const r = await lookupUsdaByBarcode('0036000291452')
    expect(r?.nutrients.kcal).toBe(10)
    expect(fetchMock.mock.calls[0][0]).toContain('query=0036000291452')
    expect(fetchMock.mock.calls[1][0]).toContain('query=36000291452')
  })

  it('returns null without fetching when the code has no digits', async () => {
    expect(await lookupUsdaByBarcode('---')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
