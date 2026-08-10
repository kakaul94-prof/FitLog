import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ExerciseEntry, HrSamples } from '@/lib/database.types'

export function useExerciseEntries(date: string) {
  return useQuery({
    queryKey: ['exercise', date],
    queryFn: async (): Promise<ExerciseEntry[]> => {
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('*')
        .eq('entry_date', date)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as ExerciseEntry[]
    },
  })
}

/** Cardio entries within an inclusive date range — for the calendar. */
export function useExerciseEntriesRange(start: string, end: string) {
  return useQuery({
    queryKey: ['exercise', 'range', start, end],
    queryFn: async (): Promise<ExerciseEntry[]> => {
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('*')
        .gte('entry_date', start)
        .lte('entry_date', end)
        .order('entry_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExerciseEntry[]
    },
  })
}

/**
 * Latest entry per distinct activity name — the add-exercise picker's "Recent"
 * list. Each row carries the full last session so it can be re-logged as-is.
 */
export function useRecentExerciseEntries(limit = 5) {
  return useQuery({
    queryKey: ['exercise', 'recentNames', limit],
    queryFn: async (): Promise<ExerciseEntry[]> => {
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60)
      if (error) throw error
      const seen = new Set<string>()
      const out: ExerciseEntry[] = []
      for (const e of (data ?? []) as ExerciseEntry[]) {
        if (seen.has(e.name)) continue
        seen.add(e.name)
        out.push(e)
        if (out.length >= limit) break
      }
      return out
    },
  })
}

export interface NewExercise {
  entry_date: string
  name: string
  met: number | null
  duration_min: number | null
  distance_mi: number | null
  load_lb: number | null
  level: number | null
  level_max: number | null
  calories: number
  avg_hr: number | null
  zone: number | null
  max_hr: number | null
  hr_samples: HrSamples | null
  zone_seconds: number[] | null
}

/**
 * The value you last used for this activity — the ruck weight you carried, or
 * how many resistance levels your machine has. Prefills the add form the way
 * strength prefills "last time". Null name = disabled, so it costs nothing on
 * an ordinary cardio entry.
 */
export function useLastCardioField(
  name: string | null,
  field: 'load_lb' | 'level_max',
) {
  return useQuery({
    queryKey: ['exerciseLastField', field, name],
    enabled: !!name,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('exercise_entries')
        .select(field)
        .eq('name', name)
        .not(field, 'is', null)
        .order('entry_date', { ascending: false })
        .limit(1)
      if (error) throw error
      return (data?.[0] as Record<string, number> | undefined)?.[field] ?? null
    },
  })
}

export function useLogExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: NewExercise) => {
      const { error } = await supabase.from('exercise_entries').insert(e)
      if (error) throw error
    },
    // Whole prefix, not just the day: the weekly cardio-goal rollup reads the
    // ['exercise','range',…] key, which a date-specific key doesn't match.
    // nutritionTrends folds burn into each day's calorie budget, so it moves too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercise'] })
      qc.invalidateQueries({ queryKey: ['nutritionTrends'] })
    },
  })
}

export function useDeleteExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('exercise_entries')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exercise'] })
      qc.invalidateQueries({ queryKey: ['nutritionTrends'] })
    },
  })
}

export function useExerciseEntry(id: string | undefined) {
  return useQuery({
    queryKey: ['exerciseEntry', id],
    enabled: !!id,
    queryFn: async (): Promise<ExerciseEntry> => {
      const { data, error } = await supabase
        .from('exercise_entries')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as ExerciseEntry
    },
  })
}

export function useUpdateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...e }: NewExercise & { id: string }) => {
      const { error } = await supabase
        .from('exercise_entries')
        .update(e)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['exercise'] })
      qc.invalidateQueries({ queryKey: ['exerciseEntry', v.id] })
      qc.invalidateQueries({ queryKey: ['nutritionTrends'] })
    },
  })
}
