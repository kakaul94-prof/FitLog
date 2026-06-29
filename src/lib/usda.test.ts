import { describe, expect, it } from 'vitest'
import { mapNutrients } from './usda'

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
