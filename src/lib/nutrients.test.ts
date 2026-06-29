import { describe, expect, it } from 'vitest'
import {
  computePortionNutrients,
  formatNutrient,
  massUnitToGrams,
  perGram,
  roundNutrients,
  scaleNutrients,
  servingOptions,
  sumNutrients,
  ingredientUnits,
  ingredientNutrients,
  ingredientServings,
  recipePerServing,
} from './nutrients'
import type { Food, Nutrients } from './database.types'

describe('scaleNutrients', () => {
  it('multiplies every amount by the factor', () => {
    expect(scaleNutrients({ kcal: 100, protein: 10 }, 2)).toEqual({
      kcal: 200,
      protein: 20,
    })
  })
  it('scales to zero', () => {
    expect(scaleNutrients({ kcal: 100 }, 0)).toEqual({ kcal: 0 })
  })
})

describe('roundNutrients', () => {
  it('rounds each amount to a whole number', () => {
    expect(roundNutrients({ kcal: 100.6, protein: 9.4, fat: 0.5 })).toEqual({
      kcal: 101,
      protein: 9,
      fat: 1,
    })
  })
})

describe('sumNutrients', () => {
  it('adds matching keys across sets', () => {
    expect(
      sumNutrients([
        { kcal: 100, protein: 10 },
        { kcal: 50, fat: 5 },
      ]),
    ).toEqual({ kcal: 150, protein: 10, fat: 5 })
  })
  it('returns an empty object for no sets', () => {
    expect(sumNutrients([])).toEqual({})
  })
})

describe('formatNutrient', () => {
  it('rounds to a whole number', () => {
    expect(formatNutrient(2.6)).toBe('3')
    expect(formatNutrient(0.4)).toBe('0') // a trace still reads as 0, not "—"
  })
  it('coerces non-finite values to "0"', () => {
    expect(formatNutrient(NaN)).toBe('0')
    expect(formatNutrient(Infinity)).toBe('0')
  })
})

describe('massUnitToGrams', () => {
  it('maps known mass units', () => {
    expect(massUnitToGrams('g')).toBe(1)
    expect(massUnitToGrams('kg')).toBe(1000)
    expect(massUnitToGrams('oz')).toBeCloseTo(28.3495, 4)
  })
  it('is case- and whitespace-insensitive', () => {
    expect(massUnitToGrams('  KG ')).toBe(1000)
  })
  it('returns null for non-mass units', () => {
    expect(massUnitToGrams('cup')).toBeNull()
  })
})

describe('perGram', () => {
  it('divides nutrients by the serving grams', () => {
    expect(perGram({ kcal: 100, protein: 8 }, 50)).toEqual({
      kcal: 2,
      protein: 0.16,
    })
  })
  it('returns null when grams are unknown or non-positive', () => {
    expect(perGram({ kcal: 100 }, null)).toBeNull()
    expect(perGram({ kcal: 100 }, 0)).toBeNull()
    expect(perGram({ kcal: 100 }, -5)).toBeNull()
  })
})

describe('computePortionNutrients', () => {
  it('prefers the portion’s own facts when present', () => {
    const out = computePortionNutrients({ kcal: 100 }, 100, {
      grams: 30,
      nutrients: { kcal: 42 },
    })
    expect(out).toEqual({ kcal: 42 })
  })
  it('auto-scales from the base by grams when no override', () => {
    // base 200 kcal per 100 g -> a 30 g portion is 60 kcal
    expect(
      computePortionNutrients({ kcal: 200 }, 100, { grams: 30 }),
    ).toEqual({ kcal: 60 })
  })
  it('returns null when neither facts nor a usable gram weight exist', () => {
    expect(computePortionNutrients({ kcal: 200 }, null, { grams: 30 })).toBeNull()
    expect(computePortionNutrients({ kcal: 200 }, 100, { grams: null })).toBeNull()
  })
})

describe('servingOptions', () => {
  const food: Food = {
    id: 'f1',
    user_id: 'u1',
    name: 'Oats',
    brand: null,
    source: 'manual',
    source_id: null,
    serving_qty: 1,
    serving_unit: 'cup',
    serving_grams: 100,
    recipe_servings: null,
    nutrients: { kcal: 200 },
    portions: [
      { id: 'p1', label: 'half cup', grams: 50 },
      { id: 'p2', label: '   ', grams: 25 }, // blank label -> skipped
    ],
    archived: false,
    created_at: '',
    updated_at: '',
  }

  it('always includes the base serving first', () => {
    const opts = servingOptions(food)
    expect(opts[0]).toMatchObject({
      id: 'base',
      label: 'cup',
      qty: 1,
      nutrients: { kcal: 200 },
    })
  })
  it('adds usable portions and scales their nutrients', () => {
    const opts = servingOptions(food)
    const half = opts.find((o) => o.id === 'p1')
    expect(half).toMatchObject({ label: 'half cup', qty: 1, nutrients: { kcal: 100 } })
  })
  it('skips blank-label portions', () => {
    expect(servingOptions(food).some((o) => o.id === 'p2')).toBe(false)
  })
})

describe('ingredientUnits', () => {
  // Oats: base = 1 cup = 100 g, 200 kcal; plus a half-cup portion.
  const food: Food = {
    id: 'f1',
    user_id: 'u1',
    name: 'Oats',
    brand: null,
    source: 'manual',
    source_id: null,
    serving_qty: 1,
    serving_unit: 'cup',
    serving_grams: 100,
    recipe_servings: null,
    nutrients: { kcal: 200, protein: 10 },
    portions: [{ id: 'p1', label: 'half cup', grams: 50 }],
    archived: false,
    created_at: '',
    updated_at: '',
  }
  // No gram weight known -> mass units can't be offered.
  const noGrams: Food = { ...food, serving_grams: null, portions: [] }

  it('offers base, portions, and mass units when grams are known', () => {
    const units = ingredientUnits(food).map((u) => u.unit)
    expect(units).toEqual(['base', 'p1', 'g', 'oz', 'lb'])
  })
  it('falls back to base only when the gram weight is unknown', () => {
    expect(ingredientUnits(noGrams).map((u) => u.unit)).toEqual(['base'])
  })
  it('scales nutrients per gram for mass units', () => {
    const g = ingredientUnits(food).find((u) => u.unit === 'g')
    expect(g?.nutrients).toEqual({ kcal: 2, protein: 0.1 }) // 200 kcal / 100 g
  })
})

describe('ingredientNutrients', () => {
  const food: Food = {
    id: 'f1',
    user_id: 'u1',
    name: 'Oats',
    brand: null,
    source: 'manual',
    source_id: null,
    serving_qty: 1,
    serving_unit: 'cup',
    serving_grams: 100,
    recipe_servings: null,
    nutrients: { kcal: 200 },
    portions: [],
    archived: false,
    created_at: '',
    updated_at: '',
  }
  it('scales the base serving by amount', () => {
    expect(ingredientNutrients(food, 2, 'base')).toEqual({ kcal: 400 })
  })
  it('weighs out a mass amount', () => {
    expect(ingredientNutrients(food, 50, 'g')).toEqual({ kcal: 100 })
  })
  it('falls back to base for an unknown unit', () => {
    expect(ingredientNutrients(food, 1, 'bogus')).toEqual({ kcal: 200 })
  })
})

describe('ingredientServings', () => {
  const food: Food = {
    id: 'f1',
    user_id: 'u1',
    name: 'Oats',
    brand: null,
    source: 'manual',
    source_id: null,
    serving_qty: 1,
    serving_unit: 'cup',
    serving_grams: 100,
    recipe_servings: null,
    nutrients: { kcal: 200 },
    portions: [],
    archived: false,
    created_at: '',
    updated_at: '',
  }
  it('returns the amount for base servings', () => {
    expect(ingredientServings(food, 2, 'base')).toBe(2)
  })
  it('converts a mass amount to a base-serving multiplier', () => {
    expect(ingredientServings(food, 50, 'g')).toBe(0.5) // 50 g / 100 g per cup
  })
})

describe('recipePerServing', () => {
  function mkFood(id: string, nutrients: Nutrients, extra: Partial<Food> = {}): Food {
    return {
      id,
      user_id: 'u1',
      name: id,
      brand: null,
      source: 'manual',
      source_id: null,
      serving_qty: 1,
      serving_unit: 'serving',
      serving_grams: null,
      recipe_servings: null,
      nutrients,
      portions: [],
      archived: false,
      created_at: '',
      updated_at: '',
      ...extra,
    }
  }
  const ri = (
    ingredient_food_id: string,
    amount: number | null,
    unit = 'base',
    servings = 1,
  ) => ({ ingredient_food_id, amount, unit, servings })

  it('sums base-serving ingredients and divides by the yield', () => {
    const byId = new Map<string, Food>([
      ['a', mkFood('a', { kcal: 100, protein: 10 })],
      ['b', mkFood('b', { kcal: 50 })],
    ])
    // (100*2 + 50*1) / 2 servings
    expect(recipePerServing([ri('a', 2), ri('b', 1)], byId, 2)).toEqual({
      kcal: 125,
      protein: 10,
    })
  })

  it('skips ingredients whose food is missing', () => {
    const byId = new Map<string, Food>([['a', mkFood('a', { kcal: 100 })]])
    expect(recipePerServing([ri('a', 1), ri('ghost', 5)], byId, 1)).toEqual({
      kcal: 100,
    })
  })

  it('falls back to the stored servings when amount is null', () => {
    const byId = new Map<string, Food>([['a', mkFood('a', { kcal: 100 })]])
    expect(recipePerServing([ri('a', null, 'base', 3)], byId, 1)).toEqual({
      kcal: 300,
    })
  })

  it('weighs out mass-unit ingredients', () => {
    const byId = new Map<string, Food>([
      ['a', mkFood('a', { kcal: 200 }, { serving_grams: 100 })],
    ])
    // 50 g of a 100 g / 200 kcal food
    expect(recipePerServing([ri('a', 50, 'g')], byId, 1)).toEqual({ kcal: 100 })
  })

  it('treats a zero yield as a single serving', () => {
    const byId = new Map<string, Food>([['a', mkFood('a', { kcal: 100 })]])
    expect(recipePerServing([ri('a', 1)], byId, 0)).toEqual({ kcal: 100 })
  })
})
