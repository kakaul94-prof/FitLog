import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ExerciseNote } from '@/lib/database.types'

// The user's own form notes for one exercise (built-in slug or 'custom:<uuid>').
export function useExerciseNotes(exerciseKey: string | undefined) {
  return useQuery({
    queryKey: ['exerciseNotes', exerciseKey],
    enabled: !!exerciseKey,
    queryFn: async (): Promise<ExerciseNote | null> => {
      const { data, error } = await supabase
        .from('exercise_notes')
        .select('*')
        .eq('exercise_key', exerciseKey!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as ExerciseNote | null
    },
  })
}

export function useUpsertExerciseNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      exercise_key: string
      notes: string | null
    }): Promise<ExerciseNote> => {
      const { data: u } = await supabase.auth.getUser()
      const user_id = u.user?.id
      if (!user_id) throw new Error('Not signed in')
      const { data, error } = await supabase
        .from('exercise_notes')
        .upsert(
          { user_id, exercise_key: v.exercise_key, notes: v.notes },
          { onConflict: 'user_id,exercise_key' },
        )
        .select('*')
        .single()
      if (error) throw error
      return data as ExerciseNote
    },
    onSuccess: (data) =>
      qc.setQueryData(['exerciseNotes', data.exercise_key], data),
  })
}
