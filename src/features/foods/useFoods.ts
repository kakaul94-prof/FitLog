import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
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

export type FoodHistory = {
  recent: Food[]
  frequent: Food[]
  /** Most-recent servings logged per food_id — pre-fills the serving sheet. */
  lastServings: Map<string, number>
}

/**
 * Recently- and frequently-logged foods, derived from the last ~60 days of
 * diary entries mapped back to live (non-archived) foods. One query feeds both
 * lists: distinct food_ids in recency order, plus per-food log counts.
 */
export function useFoodHistory() {
  return useQuery({
    queryKey: ['foodHistory'],
    queryFn: async (): Promise<FoodHistory> => {
      const since = addDaysISO(todayISO(), -60)
      const { data, error } = await supabase
        .from('diary_entries')
        .select('food_id, created_at, servings')
        .gte('entry_date', since)
        .not('food_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as { food_id: string; servings: number }[]

      const seen = new Set<string>()
      const recencyIds: string[] = []
      const counts = new Map<string, number>()
      const lastServings = new Map<string, number>()
      for (const r of rows) {
        const id = r.food_id
        if (!id) continue
        counts.set(id, (counts.get(id) ?? 0) + 1)
        if (!seen.has(id)) {
          seen.add(id)
          recencyIds.push(id)
          // Rows are newest-first, so the first sighting is the latest log.
          if (typeof r.servings === 'number') lastServings.set(id, r.servings)
        }
      }
      if (recencyIds.length === 0)
        return { recent: [], frequent: [], lastServings }

      const { data: foodRows, error: fErr } = await supabase
        .from('foods')
        .select('*')
        .in('id', recencyIds)
        .eq('archived', false)
      if (fErr) throw fErr
      const byId = new Map(
        (foodRows ?? []).map((f) => [(f as Food).id, f as Food]),
      )

      const recent = recencyIds
        .map((id) => byId.get(id))
        .filter((f): f is Food => !!f)
      const frequent = recencyIds
        .filter((id) => byId.has(id))
        .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
        .map((id) => byId.get(id) as Food)
      return {
        recent: recent.slice(0, 50),
        frequent: frequent.slice(0, 50),
        lastServings,
      }
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
  portions: Food['portions']
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
