import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { sumNutrients, scaleNutrients } from '@/lib/nutrients'
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
    .select('servings,ingredient_food_id')
    .eq('recipe_food_id', recipeFoodId)
  const ingredients = (ings ?? []) as {
    servings: number
    ingredient_food_id: string
  }[]
  const ids = ingredients.map((i) => i.ingredient_food_id)
  const foodsRes = ids.length
    ? await supabase.from('foods').select('id,nutrients').in('id', ids)
    : { data: [] }
  const byId = new Map(
    ((foodsRes.data ?? []) as { id: string; nutrients: Food['nutrients'] }[]).map(
      (f) => [f.id, f.nutrients],
    ),
  )
  const total = sumNutrients(
    ingredients.map((i) =>
      scaleNutrients(byId.get(i.ingredient_food_id) ?? {}, i.servings),
    ),
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
      ingredientFoodId,
      servings,
    }: {
      recipeFoodId: string
      ingredientFoodId: string
      servings: number
    }) => {
      const { error } = await supabase.from('recipe_ingredients').insert({
        recipe_food_id: recipeFoodId,
        ingredient_food_id: ingredientFoodId,
        servings,
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
      servings,
    }: {
      id: string
      recipeFoodId: string
      servings: number
    }) => {
      const { error } = await supabase
        .from('recipe_ingredients')
        .update({ servings })
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
