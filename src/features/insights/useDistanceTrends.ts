import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import { MACHINE_DISTANCE_NAMES } from '@/data/activities'

export interface DistanceBin {
  /** ISO first day of the bin. */
  start: string
  /** ISO last day of the bin (equals `start` for a daily bin). */
  end: string
  miles: number
}

export interface DistanceTrends {
  /** Daily bins for a short range (≤ 7 days), weekly bins for a longer one. */
  bins: DistanceBin[]
  totalMi: number
  /** Cardio entries that carried a distance (> 0). */
  walks: number
  /** Distinct days with any distance. */
  activeDays: number
}

/**
 * Distance walked/run over the last `days` (inclusive, ending today). Sums
 * `exercise_entries.distance_mi` per day, then bins it: daily bars for a short
 * range, weekly bars for a longer one so 30 days stays readable on a phone.
 * Mirrors useCardioZoneTrends' range fetch + aggregation. No schema change —
 * distance_mi already exists on the entry.
 */
export function useDistanceTrends(days: number) {
  return useQuery({
    queryKey: ['distanceTrends', days],
    queryFn: async (): Promise<DistanceTrends> => {
      const today = todayISO()
      const since = addDaysISO(today, -(days - 1))
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('entry_date,distance_mi,name')
        .gte('entry_date', since)
        .lte('entry_date', today)
      if (error) throw error

      // Per-day miles + a count of distance-carrying entries (walks).
      const perDay = new Map<string, number>()
      let walks = 0
      for (const r of (data ?? []) as {
        entry_date: string
        distance_mi: number | null
        name: string
      }[]) {
        // Machine "miles" (elliptical) aren't ground distance — keep them out.
        if (MACHINE_DISTANCE_NAMES.has(r.name)) continue
        const mi = r.distance_mi ?? 0
        if (mi <= 0) continue
        perDay.set(r.entry_date, (perDay.get(r.entry_date) ?? 0) + mi)
        walks++
      }

      // Complete daily series, oldest → newest (so gaps render as zero bars).
      const daily: { date: string; miles: number }[] = []
      for (let i = days - 1; i >= 0; i--) {
        const date = addDaysISO(today, -i)
        daily.push({ date, miles: perDay.get(date) ?? 0 })
      }

      const totalMi = daily.reduce((s, d) => s + d.miles, 0)
      const activeDays = daily.filter((d) => d.miles > 0).length

      // Bin: one bar per day for a short range; 7-day chunks (from the recent
      // end, so the latest week is always whole) for a longer one.
      const bins: DistanceBin[] = []
      if (days > 7) {
        for (let i = daily.length; i > 0; i -= 7) {
          const chunk = daily.slice(Math.max(0, i - 7), i)
          bins.unshift({
            start: chunk[0].date,
            end: chunk[chunk.length - 1].date,
            miles: round1(chunk.reduce((s, d) => s + d.miles, 0)),
          })
        }
      } else {
        for (const d of daily)
          bins.push({ start: d.date, end: d.date, miles: round1(d.miles) })
      }

      return {
        bins,
        totalMi: round1(totalMi),
        walks,
        activeDays,
      }
    },
  })
}

const round1 = (v: number) => Math.round(v * 10) / 10
