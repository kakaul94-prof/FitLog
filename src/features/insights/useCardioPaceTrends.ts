import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import { paceMinPerMi } from '@/lib/cardio'

// Type alias (not interface) so it satisfies LineChartSvg's Record row type
// via TS's implicit index signature on inferred/aliased object types.
export type PacePoint = {
  /** 'MM-DD' session date (x label). */
  date: string
  /** Decimal minutes per mile — lower is faster. */
  pace: number
}

/**
 * Aerobic-efficiency trend: pace per session for distance-based cardio logged
 * at a given HR zone, oldest → newest over the last `days`. Only entries with
 * distance, duration, AND that zone qualify — pace at a fixed effort is the
 * signal (getting faster at the same HR = aerobic base growing).
 */
export function useCardioPaceTrends(zone: number, days = 90) {
  return useQuery({
    queryKey: ['cardioPaceTrends', zone, days],
    queryFn: async (): Promise<PacePoint[]> => {
      const since = addDaysISO(todayISO(), -(days - 1))
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('entry_date,duration_min,distance_mi,zone')
        .gte('entry_date', since)
        .eq('zone', zone)
        .order('entry_date')
      if (error) throw error
      const pts: PacePoint[] = []
      for (const r of (data ?? []) as {
        entry_date: string
        duration_min: number | null
        distance_mi: number | null
      }[]) {
        const pace = paceMinPerMi(r.duration_min, r.distance_mi)
        if (pace != null)
          pts.push({
            date: r.entry_date.slice(5),
            pace: Math.round(pace * 100) / 100,
          })
      }
      return pts
    },
  })
}
