import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ProgressionMethod, StrengthGoal } from '@/lib/database.types'

/** The strength goal for one exercise (built-in slug or 'custom:<uuid>'), if any. */
export function useStrengthGoal(key: string | undefined) {
  return useQuery({
    queryKey: ['strengthGoal', key],
    enabled: !!key,
    queryFn: async (): Promise<StrengthGoal | null> => {
      const { data, error } = await supabase
        .from('strength_goals')
        .select('*')
        .eq('exercise_key', key)
        .maybeSingle()
      if (error) throw error
      return (data as StrengthGoal | null) ?? null
    },
  })
}

export interface NewStrengthGoal {
  exercise_key: string
  exercise_name: string
  target_1rm_lb: number
  method: ProgressionMethod
  increment_lb: number
  rep_low: number
  rep_high: number
  sets: number
}

export function useSaveStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (g: NewStrengthGoal): Promise<StrengthGoal> => {
      const { data, error } = await supabase
        .from('strength_goals')
        .insert(g)
        .select('*')
        .single()
      if (error) throw error
      return data as StrengthGoal
    },
    onSuccess: (g) =>
      qc.invalidateQueries({ queryKey: ['strengthGoal', g.exercise_key] }),
  })
}

/** Patch a goal by id (method switch, edits, 5/3/1 week/cycle/TM advance). */
export function useUpdateStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      exercise_key,
      ...patch
    }: { id: string; exercise_key: string } & Partial<StrengthGoal>) => {
      const { error } = await supabase
        .from('strength_goals')
        .update(patch)
        .eq('id', id)
      if (error) throw error
      return { exercise_key }
    },
    onSuccess: ({ exercise_key }) =>
      qc.invalidateQueries({ queryKey: ['strengthGoal', exercise_key] }),
  })
}

export function useDeleteStrengthGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      exercise_key,
    }: {
      id: string
      exercise_key: string
    }) => {
      const { error } = await supabase.from('strength_goals').delete().eq('id', id)
      if (error) throw error
      return { exercise_key }
    },
    onSuccess: ({ exercise_key }) =>
      qc.invalidateQueries({ queryKey: ['strengthGoal', exercise_key] }),
  })
}
