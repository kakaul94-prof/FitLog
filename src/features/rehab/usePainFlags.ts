import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { addDaysISO, todayISO } from '@/lib/date'
import type { PainFlag } from '@/lib/rehab'

/** Every pain flag logged on a set, newest first, within `days`.
 *
 *  Pain lives on workout_sets (written by the Coach feedback chips), so this is
 *  pure read — the rehab dashboard is showing you data you've already logged.
 *  Two round trips: the flagged sets, then the dates of the workouts they came
 *  from. Flagged sets are rare, so neither query is large. */
export function usePainFlags(days = 90) {
  return useQuery({
    queryKey: ['painFlags', days],
    queryFn: async (): Promise<PainFlag[]> => {
      const { data: rows, error } = await supabase
        .from('workout_sets')
        .select('pain,exercise_key,exercise_name,workout_id')
        .not('pain', 'is', null)
      if (error) throw error
      const sets = (rows ?? []) as {
        pain: string
        exercise_key: string
        exercise_name: string
        workout_id: string
      }[]
      if (sets.length === 0) return []

      const wids = [...new Set(sets.map((s) => s.workout_id))]
      const dateById = new Map<string, string>()
      const { data: ws, error: wErr } = await supabase
        .from('workouts')
        .select('id,workout_date')
        .in('id', wids)
      if (wErr) throw wErr
      for (const w of (ws ?? []) as { id: string; workout_date: string }[])
        dateById.set(w.id, w.workout_date)

      const cutoff = addDaysISO(todayISO(), -days)
      return sets
        .map((s) => ({
          pain: s.pain,
          date: dateById.get(s.workout_id) ?? '',
          exerciseKey: s.exercise_key,
          exerciseName: s.exercise_name,
        }))
        .filter((f) => f.date >= cutoff)
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  })
}
