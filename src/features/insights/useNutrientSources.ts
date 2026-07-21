import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import { NUTRIENTS } from '@/lib/nutrients'
import type { NutrientKey, Nutrients } from '@/lib/database.types'

export interface FoodContributor {
  /** food_id, or `name:<food_name>` for quick-adds with no source food. */
  id: string
  name: string
  /** Average per logged day (raw; format at display). */
  amount: number
  /** Share of the nutrient's window total, 0–100 (raw; round at display). */
  pct: number
}

export interface NutrientSources {
  /** Distinct days with ≥1 entry — the per-day average denominator. */
  loggedCount: number
  /** Ranked high→low per nutrient; foods contributing 0 are omitted. */
  byNutrient: Record<NutrientKey, FoodContributor[]>
}

/**
 * Which foods drove each nutrient over the last `days`. Groups the window's
 * diary entries by food (snapshotted `food_name` + `nutrients × servings`) and
 * returns, per nutrient, a ranked contributor list with each food's average per
 * logged day and its share of the nutrient's total. Mirrors the other insight
 * hooks' diary fetch (separate hook, one small range query, TanStack-cached).
 */
export function useNutrientSources(days: number) {
  return useQuery({
    queryKey: ['nutrientSources', days],
    queryFn: async (): Promise<NutrientSources> => {
      const today = todayISO()
      const since = addDaysISO(today, -(days - 1))
      const { data, error } = await supabase
        .from('diary_entries')
        .select('entry_date,food_id,food_name,nutrients,servings')
        .gte('entry_date', since)
      if (error) throw error

      const rows = (data ?? []) as {
        entry_date: string
        food_id: string | null
        food_name: string | null
        nutrients: Nutrients | null
        servings: number
      }[]

      // Per food: display name + summed amount per nutrient over the window.
      const names = new Map<string, string>()
      const sums = new Map<string, Map<NutrientKey, number>>()
      const loggedDates = new Set<string>()

      for (const r of rows) {
        loggedDates.add(r.entry_date)
        // Group quick-adds (no source food) by name so like-named ones merge.
        const id = r.food_id ?? `name:${r.food_name ?? 'Food'}`
        if (!names.has(id)) names.set(id, r.food_name?.trim() || 'Food')
        let bucket = sums.get(id)
        if (!bucket) {
          bucket = new Map()
          sums.set(id, bucket)
        }
        const s = r.servings ?? 0
        const n = r.nutrients ?? {}
        for (const def of NUTRIENTS) {
          const v = n[def.key]
          if (typeof v === 'number' && v > 0) {
            bucket.set(def.key, (bucket.get(def.key) ?? 0) + v * s)
          }
        }
      }

      const loggedCount = loggedDates.size

      // Nutrient totals across all foods → the denominator for each % share.
      const totals = new Map<NutrientKey, number>()
      for (const bucket of sums.values()) {
        for (const [key, v] of bucket) {
          totals.set(key, (totals.get(key) ?? 0) + v)
        }
      }

      const byNutrient = {} as Record<NutrientKey, FoodContributor[]>
      for (const def of NUTRIENTS) {
        const total = totals.get(def.key) ?? 0
        const list: FoodContributor[] = []
        if (total > 0 && loggedCount > 0) {
          for (const [id, bucket] of sums) {
            const v = bucket.get(def.key) ?? 0
            if (v > 0) {
              list.push({
                id,
                name: names.get(id) ?? 'Food',
                amount: v / loggedCount,
                pct: (v / total) * 100,
              })
            }
          }
          list.sort((a, b) => b.amount - a.amount)
        }
        byNutrient[def.key] = list
      }

      return { loggedCount, byNutrient }
    },
  })
}
