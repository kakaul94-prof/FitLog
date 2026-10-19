import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { insertOnce } from '@/lib/idempotent'
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
  /** Chosen by the app (see useSubmissionId) so a repeated save is the same row. */
  id?: string
  type: string
  value: number
  unit: string
  measured_on: string
}

// Keyed and registered as a default (registerMeasurementMutationDefaults), so
// a measurement logged offline is still sent after the app restarts: a
// restored write has only its key and variables to find its function by.
function logMeasurementMutation(
  qc: QueryClient,
): UseMutationOptions<Measurement, Error, NewMeasurement> {
  return {
    mutationKey: ['measurements', 'log'],
    mutationFn: (m) =>
      insertOnce<Measurement>('measurements', { ...m, id: m.id ?? crypto.randomUUID() }),
    // Fix the id before the write can be queued, so a replay is the same row.
    onMutate: (m) => {
      m.id ??= crypto.randomUUID()
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['measurements', vars.type] })
      if (vars.type === 'weight') {
        qc.invalidateQueries({ queryKey: ['latestWeight'] })
      }
    },
  }
}

export function useLogMeasurement() {
  return useMutation(logMeasurementMutation(useQueryClient()))
}

/** Lets a measurement queued offline resume after an app restart. Run before render. */
export function registerMeasurementMutationDefaults(qc: QueryClient) {
  qc.setMutationDefaults(['measurements', 'log'], logMeasurementMutation(qc))
}

interface MeasurementPatch {
  id: string
  measured_on?: string
  value?: number
  unit?: string
}

export function useUpdateMeasurement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: MeasurementPatch) => {
      const { error } = await supabase
        .from('measurements')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['measurements'] })
      qc.invalidateQueries({ queryKey: ['latestWeight'] })
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
