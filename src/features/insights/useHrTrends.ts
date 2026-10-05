import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'

// Type alias (not interface) so it satisfies LineChartSvg's Record row type.
export type HrPoint = {
  /** 'MM-DD' session date (x label). */
  date: string
  avg: number
  /** Session peak — only recorded sessions have one. */
  max: number | null
}

export interface HrTrends {
  points: HrPoint[]
  /** Mean of every session average in the window. */
  avg: number | null
  /** Highest peak seen, from recorded sessions only. */
  peak: number | null
  /** How many of the sessions came off a strap (i.e. carry a peak). */
  recorded: number
}

/**
 * Heart rate per cardio session, oldest → newest over the last `days`. Every
 * entry with an avg HR counts, hand-typed or recorded; the peak line only has
 * points where a strap was actually recording.
 */
export function useHrTrends(days = 90) {
  return useQuery({
    queryKey: ['hrTrends', days],
    queryFn: async (): Promise<HrTrends> => {
      const since = addDaysISO(todayISO(), -(days - 1))
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('entry_date,avg_hr,max_hr')
        .gte('entry_date', since)
        .not('avg_hr', 'is', null)
        .order('entry_date')
      if (error) throw error

      const points: HrPoint[] = []
      let sum = 0
      let peak = 0
      let recorded = 0
      for (const r of (data ?? []) as {
        entry_date: string
        avg_hr: number | null
        max_hr: number | null
      }[]) {
        if (!r.avg_hr) continue
        points.push({
          date: r.entry_date.slice(5),
          avg: r.avg_hr,
          max: r.max_hr,
        })
        sum += r.avg_hr
        if (r.max_hr) {
          recorded++
          if (r.max_hr > peak) peak = r.max_hr
        }
      }
      return {
        points,
        avg: points.length ? Math.round(sum / points.length) : null,
        peak: peak || null,
        recorded,
      }
    },
  })
}
