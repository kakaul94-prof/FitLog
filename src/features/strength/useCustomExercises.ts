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
