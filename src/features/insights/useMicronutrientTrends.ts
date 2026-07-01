import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import { NUTRIENTS } from '@/lib/nutrients'
import type { NutrientKey, Nutrients } from '@/lib/database.types'

// Only nutrients with an insight direction AND a DV can be scored.
const TRACKED = NUTRIENTS.filter((n) => n.direction != null && n.dv != null)

// A floor nutrient is "low" under this % of DV; a limit nutrient is "over" above
// it. We only trust a flag when the nutrient actually had data on at least this
// share of logged days — otherwise sparse micro data (branded/manual foods often
// carry none) would read as a shortfall.
const LOW_PCT = 70
const OVER_PCT = 100
const MIN_COVERAGE = 0.5

export interface MicroStat {
  key: NutrientKey
  label: string
  unit: string
  dv: number
  direction: 'floor' | 'limit'
  /** Average per logged day (rounded), same denominator as the macro averages. */
  avgPerDay: number
  pctDV: number
  /** Logged days that carried any data for this nutrient (data coverage). */
  daysWithData: number
  /** Floor-and-low or limit-and-over, with enough coverage to be trusted. */
  flagged: boolean
}

export interface MicroTrends {
  loggedCount: number
  stats: MicroStat[]
}

/**
 * Weekly micronutrient rollup over the last `days`: each tracked nutrient's
 * average intake vs its FDA Daily Value, with a shortfall/over flag. Mirrors
 * useNutritionTrends' diary fetch (kept a separate hook so that one's shape is
 * untouched); the extra query is the same small range, deduped by TanStack.
 */
export function useMicronutrientTrends(days: number) {
  return useQuery({
    queryKey: ['microTrends', days],
    queryFn: async (): Promise<MicroTrends> => {
      const today = todayISO()
      const since = addDaysISO(today, -(days - 1))
      const { data, error } = await supabase
        .from('diary_entries')
        .select('entry_date,nutrients,servings')
        .gte('entry_date', since)
      if (error) throw error

      const rows = (data ?? []) as {
        entry_date: string
        nutrients: Nutrients | null
        servings: number
      }[]

      const totals = new Map<NutrientKey, number>()
      const daysWith = new Map<NutrientKey, Set<string>>()
      const loggedDates = new Set<string>()
      for (const r of rows) {
        loggedDates.add(r.entry_date)
        const s = r.servings ?? 0
        const n = r.nutrients ?? {}
        for (const def of TRACKED) {
          const v = n[def.key]
          if (typeof v === 'number') {
            totals.set(def.key, (totals.get(def.key) ?? 0) + v * s)
            let set = daysWith.get(def.key)
            if (!set) {
              set = new Set()
              daysWith.set(def.key, set)
            }
            set.add(r.entry_date)
          }
        }
      }
      const loggedCount = loggedDates.size
      const minDays = Math.ceil(loggedCount * MIN_COVERAGE)

      const stats: MicroStat[] = TRACKED.map((def) => {
        const dv = def.dv as number
        const direction = def.direction as 'floor' | 'limit'
        const avg = loggedCount ? (totals.get(def.key) ?? 0) / loggedCount : 0
        const pctDV = dv > 0 ? Math.round((avg / dv) * 100) : 0
        const daysWithData = daysWith.get(def.key)?.size ?? 0
        const enough = loggedCount > 0 && daysWithData >= minDays
        const flagged =
          enough &&
          (direction === 'floor' ? pctDV < LOW_PCT : pctDV > OVER_PCT)
        return {
          key: def.key,
          label: def.label,
          unit: def.unit,
          dv,
          direction,
          avgPerDay: Math.round(avg),
          pctDV,
          daysWithData,
          flagged,
        }
      })

      // Floors first (most-deficient first), then limits (most-over first).
      stats.sort((a, b) => {
        if (a.direction !== b.direction) return a.direction === 'floor' ? -1 : 1
        return a.direction === 'floor' ? a.pctDV - b.pctDV : b.pctDV - a.pctDV
      })

      return { loggedCount, stats }
    },
  })
}
