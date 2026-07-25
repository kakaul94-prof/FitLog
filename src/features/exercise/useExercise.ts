import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ExerciseEntry } from '@/lib/database.types'

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

export interface NewExercise {
  entry_date: string
  name: string
  met: number | null
  duration_min: number | null
  distance_mi: number | null
  calories: number
  avg_hr: number | null
  zone: number | null
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercise'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercise'] }),
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
    },
  })
}
