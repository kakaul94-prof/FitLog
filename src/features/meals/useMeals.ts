import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO } from '@/lib/date'
import { syncStreakNudge } from '@/lib/reminders'
import type {
  DiaryEntry,
  Meal,
  SavedMeal,
  SavedMealItem,
} from '@/lib/database.types'

export interface MealWithItems extends SavedMeal {
  items: SavedMealItem[]
}

/** All saved meals with their items (one query each, joined client-side). */
export function useMeals() {
  return useQuery({
    queryKey: ['meals'],
    queryFn: async (): Promise<MealWithItems[]> => {
      const { data: mealsData, error } = await supabase
        .from('meals')
        .select('*')
        .order('position')
        .order('created_at')
      if (error) throw error
      const meals = (mealsData ?? []) as SavedMeal[]
      if (meals.length === 0) return []
      const { data: itemsData, error: iErr } = await supabase
        .from('meal_items')
        .select('*')
        .in(
          'meal_id',
          meals.map((m) => m.id),
        )
        .order('position')
      if (iErr) throw iErr
      const byMeal = new Map<string, SavedMealItem[]>()
      for (const it of (itemsData ?? []) as SavedMealItem[]) {
        const arr = byMeal.get(it.meal_id) ?? []
        arr.push(it)
        byMeal.set(it.meal_id, arr)
      }
      return meals.map((m) => ({ ...m, items: byMeal.get(m.id) ?? [] }))
    },
  })
}

/** Create a saved meal by snapshotting a set of diary entries as its items. */
export function useCreateMealFromEntries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      name: string
      entries: DiaryEntry[]
    }): Promise<SavedMeal> => {
      const { data, error } = await supabase
        .from('meals')
        .insert({ name: e.name })
        .select('*')
        .single()
      if (error) throw error
      const meal = data as SavedMeal
      if (e.entries.length) {
        const rows = e.entries.map((en, idx) => ({
          meal_id: meal.id,
          food_id: en.food_id,
          food_name: en.food_name,
          brand: en.brand,
          servings: en.servings,
          serving_qty: en.serving_qty,
          serving_unit: en.serving_unit,
          nutrients: en.nutrients,
          position: idx,
        }))
        const { error: iErr } = await supabase.from('meal_items').insert(rows)
        if (iErr) throw iErr
      }
      return meal
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meals'] }),
  })
}

/** A diary row inserted by useLogMeal — client-generated id so the picker's
 *  "added" tray can edit/delete the rows it just created. */
export type LoggedMealRow = {
  id: string
  entry_date: string
  meal: Meal
  food_id: string | null
  food_name: string
  brand: string | null
  servings: number
  serving_qty: number | null
  serving_unit: string | null
  nutrients: SavedMealItem['nutrients']
}

/** Log every item of a saved meal as a separate diary row in one tap. */
export function useLogMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      meal_id: string
      entry_date: string
      meal: Meal
    }): Promise<LoggedMealRow[]> => {
      const { data, error } = await supabase
        .from('meal_items')
        .select('*')
        .eq('meal_id', e.meal_id)
        .order('position')
      if (error) throw error
      const items = (data ?? []) as SavedMealItem[]
      if (items.length === 0) return []
      const rows: LoggedMealRow[] = items.map((it) => ({
        id: crypto.randomUUID(),
        entry_date: e.entry_date,
        meal: e.meal,
        food_id: it.food_id,
        food_name: it.food_name,
        brand: it.brand,
        servings: it.servings,
        serving_qty: it.serving_qty,
        serving_unit: it.serving_unit,
        nutrients: it.nutrients,
      }))
      const { error: insErr } = await supabase
        .from('diary_entries')
        .insert(rows)
      if (insErr) throw insErr
      return rows
    },
    onSuccess: (_n, v) => {
      // Logging a meal for today defers tonight's streak nudge (native only).
      if (v.entry_date === todayISO()) void syncStreakNudge(true)
      qc.invalidateQueries({ queryKey: ['diary', v.entry_date] })
      qc.invalidateQueries({ queryKey: ['streak'] })
      qc.invalidateQueries({ queryKey: ['foodHistory'] })
    },
  })
}

export function useRenameMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: { id: string; name: string }) => {
      const { error } = await supabase
        .from('meals')
        .update({ name: e.name })
        .eq('id', e.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meals'] }),
  })
}

/** Delete a saved meal (its items cascade; logged diary rows are untouched). */
export function useDeleteMeal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('meals').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meals'] }),
  })
}
