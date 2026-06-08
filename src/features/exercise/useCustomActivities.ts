import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CustomActivity } from '@/lib/database.types'

export function useCustomActivities() {
  return useQuery({
    queryKey: ['customActivities'],
    queryFn: async (): Promise<CustomActivity[]> => {
      const { data, error } = await supabase
        .from('custom_activities')
        .select('*')
        .order('name')
      if (error) throw error
      return (data ?? []) as CustomActivity[]
    },
  })
}

export function useCreateCustomActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: {
      name: string
      met: number
      distance_based: boolean
    }): Promise<CustomActivity> => {
      const { data, error } = await supabase
        .from('custom_activities')
        .insert(a)
        .select('*')
        .single()
      if (error) throw error
      return data as CustomActivity
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customActivities'] }),
  })
}

export function useUpdateCustomActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...a
    }: {
      id: string
      name: string
      met: number
      distance_based: boolean
    }) => {
      const { error } = await supabase
        .from('custom_activities')
        .update(a)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customActivities'] }),
  })
}

export function useDeleteCustomActivity() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('custom_activities')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customActivities'] }),
  })
}
