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
