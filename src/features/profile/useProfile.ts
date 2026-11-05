import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/database.types'
import type { EffortScale } from '@/lib/effort'

/** The signed-in user's profile row (RLS leaves exactly one visible): the read
 *  behind useProfile, and the call the contract tests make. */
export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .maybeSingle()
  if (error) throw error
  return data
}

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
  })
}

// RPE or RIR for set effort (More → Effort scale). Reads the cached profile, so
// every card/row can ask without extra round trips; RPE until the column exists.
export function useEffortScale(): EffortScale {
  const { data } = useProfile()
  return data?.effort_scale === 'rir' ? 'rir' : 'rpe'
}

/** Save profile fields and return the stored row: the write behind
 *  useUpdateProfile, and the call the contract tests make. */
export async function updateProfile(updates: Partial<Profile>): Promise<Profile> {
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
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateProfile,
    onSuccess: (data) => qc.setQueryData(['profile'], data),
  })
}
