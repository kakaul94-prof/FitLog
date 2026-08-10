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
 * Weekly time-in-zone over the last `days` (ending today, inclusive).
 *
 * A strap-recorded session carries `zone_seconds` — where the time actually
 * went, second by second — and that's used as-is. Everything else is a
 * hand-logged entry with a single zone for the whole session, so its full
 * `duration_min` lands in that zone; an untagged or duration-less log can't be
 * placed at all and is excluded (the Progress caption says as much). Mirrors
 * useNutritionTrends' range fetch + aggregation.
 */
export function useCardioZoneTrends(days: number) {
  return useQuery({
    queryKey: ['cardioZoneTrends', days],
    queryFn: async (): Promise<CardioZoneTrends> => {
      const since = addDaysISO(todayISO(), -(days - 1))
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('zone,duration_min,zone_seconds')
        .gte('entry_date', since)
      if (error) throw error

      const mins = [0, 0, 0, 0, 0]
      let sessions = 0
      for (const r of (data ?? []) as {
        zone: number | null
        duration_min: number | null
        zone_seconds: number[] | null
      }[]) {
        // A recorded session knows exactly where its time went.
        const secs = r.zone_seconds
        if (secs?.length === 5 && secs.some((s) => s > 0)) {
          secs.forEach((s, i) => (mins[i] += s / 60))
          sessions++
          continue
        }
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
