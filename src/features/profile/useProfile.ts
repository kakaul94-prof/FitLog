import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/database.types'

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Next-set coach opt-in, off until you turn it on from the workout page. Reads
// the cached profile, so every card/row can ask without extra round trips.
export function useCoachEnabled() {
  const { data } = useProfile()
  return data?.coach_enabled === true
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: Partial<Profile>): Promise<Profile> => {
      const { data: u } = await supabase.auth.getUser()
      const id = u.user?.id
      if (!id) throw new Error('Not signed in')
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => qc.setQueryData(['profile'], data),
  })
}
