import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import type { DiaryEntry, Food, Meal, Nutrients } from '@/lib/database.types'

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

/** A chosen serving unit, overriding the food's base serving when logging. */
export type ServingOverride = {
  serving_qty?: number
  serving_unit?: string
  nutrients?: Nutrients
}

/** Build a diary_entries row from a food + servings (snapshots the food). */
function toDiaryRow(
  entry_date: string,
  meal: Meal,
  food: Food,
  servings: number,
  unit?: ServingOverride,
) {
  return {
    entry_date,
    meal,
    food_id: food.id,
    food_name: food.name,
    brand: food.brand,
    servings,
    serving_qty: unit?.serving_qty ?? food.serving_qty,
    serving_unit: unit?.serving_unit ?? food.serving_unit,
    nutrients: unit?.nutrients ?? food.nutrients,
  }
}

export function useLogFood() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      entry_date: string
      meal: Meal
      food: Food
      servings: number
      unit?: ServingOverride
    }) => {
      const { error } = await supabase
        .from('diary_entries')
        .insert(toDiaryRow(e.entry_date, e.meal, e.food, e.servings, e.unit))
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  })
}

/** Log several foods to the same day/meal in one insert. */
export function useLogFoods() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      entry_date: string
      meal: Meal
      items: { food: Food; servings: number; unit?: ServingOverride }[]
    }) => {
      if (e.items.length === 0) return
      const rows = e.items.map((it) =>
        toDiaryRow(e.entry_date, e.meal, it.food, it.servings, it.unit),
      )
      const { error } = await supabase.from('diary_entries').insert(rows)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  })
}

/** Copy all entries of one meal from another day into a target day/meal. */
export function useCopyMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      from: string
      to: string
      meal: Meal
    }): Promise<number> => {
      const { data, error } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('entry_date', e.from)
        .eq('meal', e.meal)
        .order('created_at')
      if (error) throw error
      const src = (data ?? []) as DiaryEntry[]
      if (src.length === 0) return 0
      const rows = src.map((r) => ({
        entry_date: e.to,
        meal: e.meal,
        food_id: r.food_id,
        food_name: r.food_name,
        brand: r.brand,
        servings: r.servings,
        serving_qty: r.serving_qty,
        serving_unit: r.serving_unit,
        nutrients: r.nutrients,
      }))
      const { error: insErr } = await supabase
        .from('diary_entries')
        .insert(rows)
      if (insErr) throw insErr
      return rows.length
    },
    onSuccess: (_n, v) => {
      qc.invalidateQueries({ queryKey: ['diary', v.to] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
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
      qc.invalidateQueries({ queryKey: ['streak'] })
    },
  })
}

/**
 * Food-logging streak: consecutive days (ending today, or yesterday if today
 * isn't logged yet) that have >=1 food entry. Computed fresh from the data each
 * time, so backfilling a missed day heals the gap and the streak resumes.
 */
export function useStreak() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: async (): Promise<number> => {
      const since = addDaysISO(todayISO(), -800)
      const { data, error } = await supabase
        .from('diary_entries')
        .select('entry_date')
        .gte('entry_date', since)
      if (error) throw error
      const logged = new Set((data ?? []).map((r) => r.entry_date as string))
      let day = todayISO()
      if (!logged.has(day)) day = addDaysISO(day, -1) // morning grace
      let count = 0
      while (logged.has(day)) {
        count++
        day = addDaysISO(day, -1)
      }
      return count
    },
  })
}
