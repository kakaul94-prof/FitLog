import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CustomExercise } from '@/lib/database.types'

export function useCustomExercises() {
  return useQuery({
    queryKey: ['customExercises'],
    queryFn: async (): Promise<CustomExercise[]> => {
      const { data, error } = await supabase
        .from('custom_exercises')
        .select('*')
        .order('name')
      if (error) throw error
      return (data ?? []) as CustomExercise[]
    },
  })
}

// How many times each custom exercise appears in a logged workout, keyed by the
// exercise id (i.e. the part after `custom:`). Used to sort by "most used".
export function useCustomExerciseUsage() {
  return useQuery({
    queryKey: ['customExerciseUsage'],
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('workout_exercises')
        .select('exercise_key')
        .like('exercise_key', 'custom:%')
      if (error) throw error
      const counts = new Map<string, number>()
      for (const { exercise_key } of (data ?? []) as { exercise_key: string }[]) {
        const id = exercise_key.slice('custom:'.length)
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      return counts
    },
  })
}

export function useCreateCustomExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (e: {
      name: string
      muscle: string | null
      equipment: string | null
      type: CustomExercise['type']
    }): Promise<CustomExercise> => {
      const { data, error } = await supabase
        .from('custom_exercises')
        .insert(e)
        .select('*')
        .single()
      if (error) throw error
      return data as CustomExercise
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customExercises'] }),
  })
}

export function useUpdateCustomExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<
      Pick<CustomExercise, 'name' | 'muscle' | 'equipment' | 'type'>
    >) => {
      const { error } = await supabase
        .from('custom_exercises')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customExercises'] }),
  })
}

// Deletes the library row only. Past workouts/templates keep their own
// exercise_key + exercise_name snapshot (no FK), so history is unaffected — the
// lift just stops appearing in the pickers.
export function useDeleteCustomExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('custom_exercises')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customExercises'] }),
  })
}
