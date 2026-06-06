import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Measurement } from '@/lib/database.types'

export function useMeasurements(type = 'weight') {
  return useQuery({
    queryKey: ['measurements', type],
    queryFn: async (): Promise<Measurement[]> => {
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('type', type)
        .order('measured_on', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useLatestWeight() {
  return useQuery({
    queryKey: ['latestWeight'],
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('measurements')
        .select('value')
        .eq('type', 'weight')
        .order('measured_on', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data?.value ?? null
    },
  })
}

interface NewMeasurement {
  type: string
  value: number
  unit: string
  measured_on: string
}

export function useLogMeasurement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: NewMeasurement): Promise<Measurement> => {
      const { data, error } = await supabase
        .from('measurements')
        .insert(m)
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['measurements', vars.type] })
      if (vars.type === 'weight') {
        qc.invalidateQueries({ queryKey: ['latestWeight'] })
      }
    },
  })
}

export function useDeleteMeasurement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('measurements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements'] })
      qc.invalidateQueries({ queryKey: ['latestWeight'] })
    },
  })
}
