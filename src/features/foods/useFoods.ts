import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Food } from '@/lib/database.types'

export function useFoods(search = '') {
  return useQuery({
    queryKey: ['foods', search],
    queryFn: async (): Promise<Food[]> => {
      let q = supabase
        .from('foods')
        .select('*')
        .eq('archived', false)
        .order('updated_at', { ascending: false })
        .limit(50)
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Food[]
    },
  })
}

export function useFood(id: string | undefined) {
  return useQuery({
    queryKey: ['food', id],
    enabled: !!id,
    queryFn: async (): Promise<Food | null> => {
      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as Food | null
    },
  })
}

export type FoodInput = {
  id?: string
  name: string
  brand: string | null
  source: Food['source']
  source_id: string | null
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  recipe_servings: number | null
  nutrients: Food['nutrients']
}

export function useSaveFood() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...food }: FoodInput): Promise<Food> => {
      if (id) {
        const { data, error } = await supabase
          .from('foods')
          .update(food)
          .eq('id', id)
          .select('*')
          .single()
        if (error) throw error
        return data as Food
      }
      const { data, error } = await supabase
        .from('foods')
        .insert(food)
        .select('*')
        .single()
      if (error) throw error
      return data as Food
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods'] }),
  })
}

export function useDeleteFood() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('foods')
        .update({ archived: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods'] }),
  })
}
