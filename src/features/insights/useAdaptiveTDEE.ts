import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { todayISO, addDaysISO } from '@/lib/date'
import { estimateAdaptiveTDEE, type AdaptiveTDEEResult } from '@/lib/calc'

/**
 * Data-driven maintenance estimate over the last `windowDays`: pulls each day's
 * logged calories + weigh-ins and runs the energy-balance calc (see calc.ts).
 */
export function useAdaptiveTDEE(windowDays = 28) {
  return useQuery({
    queryKey: ['adaptiveTDEE', windowDays],
    queryFn: async (): Promise<AdaptiveTDEEResult> => {
      const since = addDaysISO(todayISO(), -windowDays)
      const [diaryRes, weightRes] = await Promise.all([
        supabase
          .from('diary_entries')
          .select('entry_date,nutrients,servings')
          .gte('entry_date', since),
        supabase
          .from('measurements')
          .select('measured_on,value')
          .eq('type', 'weight')
          .gte('measured_on', since)
          .order('measured_on', { ascending: true }),
      ])
      if (diaryRes.error) throw diaryRes.error
      if (weightRes.error) throw weightRes.error

      const byDate = new Map<string, number>()
      for (const r of (diaryRes.data ?? []) as {
        entry_date: string
        nutrients: { kcal?: number } | null
        servings: number
      }[]) {
        const kcal = (r.nutrients?.kcal ?? 0) * (r.servings ?? 0)
        byDate.set(r.entry_date, (byDate.get(r.entry_date) ?? 0) + kcal)
      }
      const intakeDays = [...byDate].map(([date, kcal]) => ({ date, kcal }))
      const weights = (
        (weightRes.data ?? []) as { measured_on: string; value: number }[]
      ).map((w) => ({ date: w.measured_on, value: w.value }))

      return estimateAdaptiveTDEE(intakeDays, weights)
    },
  })
}
