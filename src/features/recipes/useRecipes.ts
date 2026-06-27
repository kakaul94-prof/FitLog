import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  sumNutrients,
  scaleNutrients,
  ingredientNutrients,
  ingredientServings,
} from '@/lib/nutrients'
import type { Food, RecipeIngredient } from '@/lib/database.types'

/** Recompute a recipe food's per-serving nutrients from its ingredients. */
async function recompute(recipeFoodId: string) {
  const { data: food } = await supabase
    .from('foods')
    .select('recipe_servings')
    .eq('id', recipeFoodId)
    .single()
  const yieldServings =
    (food as { recipe_servings: number | null } | null)?.recipe_servings || 1
  const { data: ings } = await supabase
    .from('recipe_ingredients')
    .select('servings,amount,unit,ingredient_food_id')
    .eq('recipe_food_id', recipeFoodId)
  const ingredients = (ings ?? []) as {
    servings: number
    amount: number | null
    unit: string | null
    ingredient_food_id: string
  }[]
  const ids = ingredients.map((i) => i.ingredient_food_id)
  const foodsRes = ids.length
    ? await supabase.from('foods').select('*').in('id', ids)
    : { data: [] }
  const byId = new Map(((foodsRes.data ?? []) as Food[]).map((f) => [f.id, f]))
  const total = sumNutrients(
    ingredients.map((i) => {
      const f = byId.get(i.ingredient_food_id)
      if (!f) return {}
      return ingredientNutrients(f, i.amount ?? i.servings, i.unit ?? 'base')
    }),
  )
  const perServing = scaleNutrients(total, 1 / yieldServings)
  await supabase
    .from('foods')
    .update({ nutrients: perServing })
    .eq('id', recipeFoodId)
}

export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: async (): Promise<Food[]> => {
      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .eq('source', 'recipe')
        .eq('archived', false)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Food[]
    },
  })
}

export interface RecipeIngredientRow {
  ri: RecipeIngredient
  food: Food | null
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: recipe } = await supabase
        .from('foods')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      const { data: ris } = await supabase
        .from('recipe_ingredients')
        .select('*')
        .eq('recipe_food_id', id)
        .order('position')
      const riList = (ris ?? []) as RecipeIngredient[]
      const ingIds = riList.map((r) => r.ingredient_food_id)
      const foodsRes = ingIds.length
        ? await supabase.from('foods').select('*').in('id', ingIds)
        : { data: [] }
      const byId = new Map(
        ((foodsRes.data ?? []) as Food[]).map((f) => [f.id, f]),
      )
      const ingredients: RecipeIngredientRow[] = riList.map((ri) => ({
        ri,
        food: byId.get(ri.ingredient_food_id) ?? null,
      }))
      return { recipe: (recipe as Food | null) ?? null, ingredients }
    },
  })
}

export function useCreateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<Food> => {
      const { data, error } = await supabase
        .from('foods')
        .insert({
          name,
          source: 'recipe',
          recipe_servings: 1,
          serving_qty: 1,
          serving_unit: 'serving',
          nutrients: {},
        })
        .select('*')
        .single()
      if (error) throw error
      return data as Food
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  })
}

/**
 * Fork a recipe: create a new recipe food that copies the source's meta and all
 * its ingredients, so it can be renamed and tweaked independently. Per-serving
 * nutrients are recomputed from the copied ingredients.
 */
export function useDuplicateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sourceId: string): Promise<Food> => {
      const { data: srcData, error: srcErr } = await supabase
        .from('foods')
        .select('*')
        .eq('id', sourceId)
        .single()
      if (srcErr) throw srcErr
      const source = srcData as Food

      const { data: risData, error: riErr } = await supabase
        .from('recipe_ingredients')
        .select('ingredient_food_id,amount,unit,servings,position')
        .eq('recipe_food_id', sourceId)
        .order('position')
      if (riErr) throw riErr
      const ingredients = (risData ?? []) as Pick<
        RecipeIngredient,
        'ingredient_food_id' | 'amount' | 'unit' | 'servings' | 'position'
      >[]

      const { data: created, error: createErr } = await supabase
        .from('foods')
        .insert({
          name: `${source.name} (copy)`,
          source: 'recipe',
          recipe_servings: source.recipe_servings ?? 1,
          serving_qty: source.serving_qty ?? 1,
          serving_unit: source.serving_unit ?? 'serving',
          serving_grams: source.serving_grams,
          portions: source.portions ?? [],
          nutrients: source.nutrients ?? {},
        })
        .select('*')
        .single()
      if (createErr) throw createErr
      const copy = created as Food

      if (ingredients.length) {
        const { error: insErr } = await supabase
          .from('recipe_ingredients')
          .insert(
            ingredients.map((i, idx) => ({
              recipe_food_id: copy.id,
              ingredient_food_id: i.ingredient_food_id,
              amount: i.amount,
              unit: i.unit,
              servings: i.servings,
              position: i.position ?? idx,
            })),
          )
        if (insErr) throw insErr
        await recompute(copy.id)
      }
      return copy
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

/** Delete a recipe (archive the recipe food; ingredients + logged snapshots are left intact). */
export function useDeleteRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('foods')
        .update({ archived: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

export function useUpdateRecipe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string
      name?: string
      recipe_servings?: number
    }) => {
      const { error } = await supabase.from('foods').update(patch).eq('id', id)
      if (error) throw error
      await recompute(id)
      return { id }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['recipe', d.id] })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

export function useAddIngredient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      recipeFoodId,
      food,
      amount,
      unit,
    }: {
      recipeFoodId: string
      food: Food
      amount: number
      unit: string
    }) => {
      const { error } = await supabase.from('recipe_ingredients').insert({
        recipe_food_id: recipeFoodId,
        ingredient_food_id: food.id,
        amount,
        unit,
        servings: ingredientServings(food, amount, unit),
      })
      if (error) throw error
      await recompute(recipeFoodId)
      return { recipeFoodId }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['recipe', d.recipeFoodId] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

export function useUpdateIngredient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      recipeFoodId,
      food,
      amount,
      unit,
    }: {
      id: string
      recipeFoodId: string
      food: Food
      amount: number
      unit: string
    }) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .update({ amount, unit, servings: ingredientServings(food, amount, unit) })
        .eq('id', id)
      if (error) throw error
      await recompute(recipeFoodId)
      return { recipeFoodId }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['recipe', d.recipeFoodId] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

export function useRemoveIngredient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      recipeFoodId,
    }: {
      id: string
      recipeFoodId: string
    }) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('id', id)
      if (error) throw error
      await recompute(recipeFoodId)
      return { recipeFoodId }
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['recipe', d.recipeFoodId] })
      qc.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}
