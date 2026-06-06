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

export interface NewExercise {
  entry_date: string
  name: string
  met: number | null
  duration_min: number | null
  distance_mi: number | null
  calories: number
}

export function useLogExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: NewExercise) => {
      const { error } = await supabase.from('exercise_entries').insert(e)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      qc.invalidateQueries({ queryKey: ['exercise', v.entry_date] }),
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
