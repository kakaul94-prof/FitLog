import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'

export interface ZoneMinutes {
  zone: number
  minutes: number
}

export interface CardioZoneTrends {
  /** Length 5, zone 1..5 in order. */
  zones: ZoneMinutes[]
  totalMinutes: number
  /** Cardio entries counted (had BOTH a zone and a duration). */
  sessions: number
}

/**
 * Weekly time-in-zone: sums `duration_min` by zone over the last `days`
 * (ending today, inclusive). Only entries carrying BOTH a zone and a duration
 * contribute — an untagged or duration-less cardio log can't be placed on the
 * split, so it's excluded (the Progress caption says as much). Mirrors
 * useNutritionTrends' range fetch + aggregation.
 */
export function useCardioZoneTrends(days: number) {
  return useQuery({
    queryKey: ['cardioZoneTrends', days],
    queryFn: async (): Promise<CardioZoneTrends> => {
      const since = addDaysISO(todayISO(), -(days - 1))
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('zone,duration_min')
        .gte('entry_date', since)
      if (error) throw error

      const mins = [0, 0, 0, 0, 0]
      let sessions = 0
      for (const r of (data ?? []) as {
        zone: number | null
        duration_min: number | null
      }[]) {
        if (r.zone == null || r.zone < 1 || r.zone > 5) continue
        if (!r.duration_min || r.duration_min <= 0) continue
        mins[r.zone - 1] += r.duration_min
        sessions++
      }

      return {
        zones: mins.map((m, i) => ({ zone: i + 1, minutes: Math.round(m) })),
        totalMinutes: Math.round(mins.reduce((a, b) => a + b, 0)),
        sessions,
      }
    },
  })
}
