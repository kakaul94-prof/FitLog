import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { DiaryEntry, Food, Meal } from '@/lib/database.types'

export function useDiary(date: string) {
  return useQuery({
    queryKey: ['diary', date],
    queryFn: async (): Promise<DiaryEntry[]> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('entry_date', date)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as DiaryEntry[]
    },
  })
}

export function useLogFood() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      entry_date: string
      meal: Meal
      food: Food
      servings: number
    }) => {
      const { error } = await supabase.from('diary_entries').insert({
        entry_date: e.entry_date,
        meal: e.meal,
        food_id: e.food.id,
        food_name: e.food.name,
        brand: e.food.brand,
        servings: e.servings,
        serving_qty: e.food.serving_qty,
        serving_unit: e.food.serving_unit,
        nutrients: e.food.nutrients,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] }),
  })
}

export function useUpdateDiaryServings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: { id: string; servings: number }) => {
      const { error } = await supabase
        .from('diary_entries')
        .update({ servings: e.servings })
        .eq('id', e.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  })
}

export function useDeleteDiaryEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('diary_entries')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
  })
}

export function useDiaryEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['diaryEntry', id],
    enabled: !!id,
    queryFn: async (): Promise<DiaryEntry | null> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as DiaryEntry | null
    },
  })
}

export function useUpdateDiaryEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<DiaryEntry>) => {
      const { error } = await supabase
        .from('diary_entries')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['diaryEntry'] })
    },
  })
}
