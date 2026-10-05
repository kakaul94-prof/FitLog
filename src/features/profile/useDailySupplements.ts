import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useProfile } from './useProfile'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import type { Food, Nutrients } from '@/lib/database.types'

export interface ResolvedSupplement {
  food_id: string
  servings: number
  food: Food
}

/**
 * The user's daily supplements (e.g. a multivitamin) resolved to their foods,
 * plus `dailyMicros` — the combined per-day nutrient contribution (each food's
 * per-serving nutrients × servings, summed). Feeds the ProfilePage manager and
 * useMicronutrientTrends, which folds `dailyMicros` into the weekly rollup.
 *
 * The supplement ids live on the profile, so a supplement change invalidates
 * ['profile'] and cascades here (and into the micro trends via the queryKey).
 */
export function useDailySupplements() {
  const { data: profile } = useProfile()
  const raw = profile?.daily_supplements ?? []
  const ids = raw.map((s) => s.food_id)

  const foodsQuery = useQuery({
    queryKey: ['supplementFoods', ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Food[]> => {
      // No archived filter: a supplement is referenced explicitly, so it keeps
      // counting even if archived out of the food library.
      const { data, error } = await supabase
        .from('foods')
        .select('*')
        .in('id', ids)
      if (error) throw error
      return (data ?? []) as Food[]
    },
  })

  const foods = foodsQuery.data
  return useMemo(() => {
    const byId = new Map((foods ?? []).map((f) => [f.id, f]))
    const supplements: ResolvedSupplement[] = raw
      .map((s) => {
        const food = byId.get(s.food_id)
        return food ? { food_id: s.food_id, servings: s.servings, food } : null
      })
      .filter((s): s is ResolvedSupplement => s != null)
    const dailyMicros: Nutrients = sumNutrients(
      supplements.map((s) => scaleNutrients(s.food.nutrients, s.servings)),
    )
    return {
      supplements,
      dailyMicros,
      isLoading: ids.length > 0 && foodsQuery.isLoading,
    }
    // `raw` is derived fresh from profile each render; gate on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foods, JSON.stringify(raw)])
}
