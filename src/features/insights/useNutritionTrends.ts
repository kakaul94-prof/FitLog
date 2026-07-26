import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import type { Nutrients } from '@/lib/database.types'

export interface NutritionDay {
  date: string
  kcal: number
  protein: number
  carb: number
  fat: number
  /** Cardio calories logged that day. Callers add this to the day's calorie
   * goal, matching the diary ring's `goal + burned` budget. Strength workouts
   * carry no calorie value, so only `exercise_entries` contributes. */
  burned: number
  /** True if the day had >=1 food entry (so callers can average over logged days
   * and charts can show real calendar gaps). */
  logged: boolean
}

/**
 * Per-day food totals + cardio burn over the last `days` (ending today,
 * inclusive). Returns a complete day-by-day array across the window — unlogged
 * days are present with zeros and `logged: false`. Mirrors useAdaptiveTDEE's
 * diary fetch/aggregation.
 */
export function useNutritionTrends(days: number) {
  return useQuery({
    queryKey: ['nutritionTrends', days],
    queryFn: async (): Promise<NutritionDay[]> => {
      const today = todayISO()
      const since = addDaysISO(today, -(days - 1))
      const [{ data, error }, { data: exData, error: exError }] =
        await Promise.all([
          supabase
            .from('diary_entries')
            .select('entry_date,nutrients,servings')
            .gte('entry_date', since),
          supabase
            .from('exercise_entries')
            .select('entry_date,calories')
            .gte('entry_date', since),
        ])
      if (error) throw error
      if (exError) throw exError

      const byDate = new Map<
        string,
        { kcal: number; protein: number; carb: number; fat: number }
      >()
      for (const r of (data ?? []) as {
        entry_date: string
        nutrients: Nutrients | null
        servings: number
      }[]) {
        const s = r.servings ?? 0
        const n = r.nutrients ?? {}
        const cur = byDate.get(r.entry_date) ?? {
          kcal: 0,
          protein: 0,
          carb: 0,
          fat: 0,
        }
        cur.kcal += (n.kcal ?? 0) * s
        cur.protein += (n.protein ?? 0) * s
        cur.carb += (n.carb ?? 0) * s
        cur.fat += (n.fat ?? 0) * s
        byDate.set(r.entry_date, cur)
      }

      const burnedByDate = new Map<string, number>()
      for (const r of (exData ?? []) as {
        entry_date: string
        calories: number | null
      }[]) {
        burnedByDate.set(
          r.entry_date,
          (burnedByDate.get(r.entry_date) ?? 0) + (r.calories ?? 0),
        )
      }

      const out: NutritionDay[] = []
      for (let i = days - 1; i >= 0; i--) {
        const date = addDaysISO(today, -i)
        const t = byDate.get(date)
        out.push({
          date,
          kcal: Math.round(t?.kcal ?? 0),
          protein: Math.round(t?.protein ?? 0),
          carb: Math.round(t?.carb ?? 0),
          fat: Math.round(t?.fat ?? 0),
          burned: Math.round(burnedByDate.get(date) ?? 0),
          logged: !!t,
        })
      }
      return out
    },
  })
}
