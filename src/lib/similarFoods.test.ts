import { describe, expect, it } from 'vitest'
import {
  findSimilarFoods,
  nameBrandMatch,
  normalizeBarcode,
  nutritionMatch,
  type MatchableFood,
  type ScanCandidate,
} from './similarFoods'

let n = 0
function food(over: Partial<MatchableFood> = {}): MatchableFood {
  n += 1
  return {
    id: `f${n}`,
    name: 'Greek yogurt, plain',
    brand: 'Chobani',
    source: 'manual',
    source_id: null,
    serving_grams: 150,
    nutrients: { kcal: 90, protein: 16, carb: 6, fat: 0 },
    archived: false,
    ...over,
  }
}
function scan(over: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    name: 'Greek yogurt, plain',
    brand: 'Chobani',
    barcode: null,
    serving_grams: 150,
    nutrients: { kcal: 90, protein: 16, carb: 6, fat: 0 },
    ...over,
  }
}

describe('normalizeBarcode', () => {
  it('keeps digits only and drops leading zeros so UPC-A equals its EAN-13 form', () => {
    expect(normalizeBarcode(' 0 123456 789012 ')).toBe('123456789012')
    expect(normalizeBarcode('012345678905')).toBe(normalizeBarcode('0012345678905'))
  })
  it('is empty for null or non-digit input', () => {
    expect(normalizeBarcode(null)).toBe('')
    expect(normalizeBarcode('abc')).toBe('')
  })
})

describe('nameBrandMatch', () => {
  it('ignores case, punctuation and accents', () => {
    expect(
      nameBrandMatch(
        { name: 'Greek Yogurt, Plain', brand: 'CHOBANI' },
        { name: 'greek yogurt plain', brand: 'Chobani' },
      ),
    ).toBe(true)
    expect(
      nameBrandMatch(
        { name: 'Crème fraîche', brand: null },
        { name: 'creme fraiche', brand: null },
      ),
    ).toBe(true)
  })
  it('lets a missing brand on either side match', () => {
    expect(nameBrandMatch({ name: 'Oats', brand: '' }, { name: 'Oats', brand: 'Quaker' })).toBe(
      true,
    )
    expect(nameBrandMatch({ name: 'Oats', brand: 'Quaker' }, { name: 'Oats', brand: null })).toBe(
      true,
    )
  })
  it('rejects a different brand or name, and never matches two nameless foods', () => {
    expect(nameBrandMatch({ name: 'Oats', brand: 'Quaker' }, { name: 'Oats', brand: 'Bobs' })).toBe(
      false,
    )
    expect(nameBrandMatch({ name: 'Oats', brand: null }, { name: 'Oat bran', brand: null })).toBe(
      false,
    )
    expect(nameBrandMatch({ name: '', brand: null }, { name: '  ', brand: null })).toBe(false)
  })
})

describe('nutritionMatch', () => {
  it('passes when every macro is within 10%', () => {
    expect(
      nutritionMatch(scan(), {
        serving_grams: 150,
        nutrients: { kcal: 95, protein: 15, carb: 6.4, fat: 0 },
      }),
    ).toBe(true)
  })
  it('fails when one macro is off by more than 10%', () => {
    expect(
      nutritionMatch(scan(), {
        serving_grams: 150,
        nutrients: { kcal: 90, protein: 12, carb: 6, fat: 0 },
      }),
    ).toBe(false)
  })
  it('compares per 100 g when both sides know their serving weight', () => {
    const bar = { serving_grams: 60, nutrients: { kcal: 200, protein: 21, carb: 21, fat: 8 } }
    const per100 = {
      serving_grams: 100,
      nutrients: { kcal: 333, protein: 35, carb: 35, fat: 13 },
    }
    expect(nutritionMatch(bar, per100)).toBe(true)
  })
  it('compares per serving when a weight is missing', () => {
    const bar = { serving_grams: null, nutrients: { kcal: 200, protein: 21, carb: 21, fat: 8 } }
    expect(
      nutritionMatch(bar, {
        serving_grams: 100,
        nutrients: { kcal: 333, protein: 35, carb: 35, fat: 13 },
      }),
    ).toBe(false)
    expect(
      nutritionMatch(bar, {
        serving_grams: null,
        nutrients: { kcal: 190, protein: 20, carb: 22, fat: 8 },
      }),
    ).toBe(true)
  })
  it('tolerates near-zero values via the absolute floor', () => {
    expect(
      nutritionMatch(scan(), {
        serving_grams: 150,
        nutrients: { kcal: 90, protein: 16, carb: 6, fat: 0.4 },
      }),
    ).toBe(true)
  })
  it('needs calories on both sides', () => {
    expect(
      nutritionMatch(scan({ nutrients: { protein: 16 } }), {
        serving_grams: 150,
        nutrients: { kcal: 90, protein: 16 },
      }),
    ).toBe(false)
    expect(
      nutritionMatch(scan(), {
        serving_grams: 150,
        nutrients: { protein: 16, carb: 6, fat: 0 },
      }),
    ).toBe(false)
  })
})

describe('findSimilarFoods', () => {
  it('matches a barcode only against foods saved from a scan, not USDA ids', () => {
    const saved = food({
      source_id: '0012345678905',
      name: 'Renamed yogurt',
      nutrients: { kcal: 500 },
    })
    const usda = food({
      source: 'usda',
      source_id: '12345678905',
      name: 'Other',
      nutrients: { kcal: 500 },
    })
    const hits = findSimilarFoods(
      scan({ barcode: '012345678905', name: 'Zzz', nutrients: { kcal: 1 } }),
      [usda, saved],
    )
    expect(hits).toEqual([{ food: saved, reason: 'barcode' }])
  })
  it('skips archived foods', () => {
    expect(findSimilarFoods(scan(), [food({ archived: true })])).toEqual([])
  })
  it('lists each food once under its strongest reason: barcode, then name, then nutrition', () => {
    const byNutrition = food({
      name: 'Nonfat yogurt',
      brand: null,
      nutrients: { kcal: 92, protein: 16, carb: 6, fat: 0 },
    })
    const byName = food({ brand: null, nutrients: { kcal: 300 } })
    const byBoth = food({ source_id: '111', nutrients: { kcal: 300 } })
    const hits = findSimilarFoods(scan({ barcode: '111' }), [byNutrition, byName, byBoth])
    expect(hits.map((h) => [h.food.id, h.reason])).toEqual([
      [byBoth.id, 'barcode'],
      [byName.id, 'name'],
      [byNutrition.id, 'nutrition'],
    ])
  })
  it('needs a shared name word before close nutrition counts', () => {
    // Low-calorie, nearly all-carb foods line up on macros by coincidence.
    const coconutWater = food({
      name: 'Coconut water',
      brand: 'Vita Coco',
      serving_grams: 330,
      nutrients: { kcal: 60, protein: 0, carb: 15, fat: 0 },
    })
    const pieFilling = scan({
      name: 'Sugar free apple pie filling',
      brand: 'Lucky Leaf',
      barcode: '041100000000',
      serving_grams: 330,
      nutrients: { kcal: 62, protein: 0.3, carb: 15.5, fat: 0 },
    })
    expect(nutritionMatch(pieFilling, coconutWater)).toBe(true)
    expect(findSimilarFoods(pieFilling, [coconutWater])).toEqual([])
    // Filler words ("sugar free") don't count as shared.
    expect(findSimilarFoods(pieFilling, [{ ...coconutWater, name: 'Sugar free cola' }])).toEqual(
      [],
    )
    // A real overlap ("croutons" vs "crouton") still flags it.
    const croutons = food({ name: 'Garlic croutons', brand: null, nutrients: { kcal: 30 } })
    expect(
      findSimilarFoods(scan({ name: 'Crouton bites', brand: null, nutrients: { kcal: 31 } }), [
        croutons,
      ]),
    ).toEqual([{ food: croutons, reason: 'nutrition' }])
  })
  it('caps the list', () => {
    const lib = [food(), food(), food(), food(), food()]
    expect(findSimilarFoods(scan(), lib)).toHaveLength(3)
    expect(findSimilarFoods(scan(), lib, 1)).toHaveLength(1)
  })
  it('returns nothing when no library food looks alike', () => {
    expect(
      findSimilarFoods(
        scan({
          name: 'Mystery',
          brand: null,
          nutrients: { kcal: 999, protein: 1, carb: 1, fat: 1 },
        }),
        [food()],
      ),
    ).toEqual([])
  })
})
