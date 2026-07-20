import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { readSteps, requestStepsPermission } from '@/lib/stepsNative'

/**
 * Live-read the day's passive step count from Health Connect. Disabled on web
 * (returns no data → the Diary steps row renders nothing). Re-reads on window
 * focus so returning to the app after a walk shows the updated total.
 */
export function useSteps(date: string) {
  return useQuery({
    queryKey: ['steps', date],
    queryFn: () => readSteps(date),
    enabled: Capacitor.isNativePlatform(),
    staleTime: 30_000,
  })
}

/** Ask Health Connect for READ_STEPS, then re-read the day on success. */
export function useConnectSteps(date: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: requestStepsPermission,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['steps', date] }),
  })
}
