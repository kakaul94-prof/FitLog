import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { supabase } from '@/lib/supabase'
import { readWeights, requestWeightPermission, type StepsStatus } from '@/lib/stepsNative'
import { maxRecordTime, planWeightInserts } from '@/lib/weightSync'

// Health Connect → measurements weight sync (Android app only; read-only).
// Runs on app open / foreground resume: reads weigh-ins written by other apps
// (smart scale), inserts one lb row per new day, skips any day that already has
// a weight row so manual logs are never doubled. A localStorage watermark marks
// the last record time seen, so a synced row you delete in-app stays deleted.

const WATERMARK_KEY = 'fitlog:weightSync:watermark'
const BACKFILL_DAYS = 30
const MIN_INTERVAL_MS = 60_000

let inFlight = false
let lastRun = 0

/** Sync once. Resolves the number of weigh-ins imported (0 = nothing new). */
export async function syncWeightsFromHealthConnect(
  qc: QueryClient,
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0
  if (inFlight) return 0
  if (!opts.force && Date.now() - lastRun < MIN_INTERVAL_MS) return 0
  inFlight = true
  try {
    const watermark = localStorage.getItem(WATERMARK_KEY)
    // +1ms past the watermark: TimeRangeFilter.after is inclusive of the boundary.
    const since = watermark
      ? new Date(Date.parse(watermark) + 1).toISOString()
      : new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString()
    const res = await readWeights(since)
    if (!res || res.status !== 'ok') return 0
    const records = res.records ?? []
    if (records.length === 0) return 0

    const dates = [...new Set(records.map((r) => r.date))]
    const { data: existing, error } = await supabase
      .from('measurements')
      .select('measured_on')
      .eq('type', 'weight')
      .in('measured_on', dates)
    if (error) throw error

    const inserts = planWeightInserts(
      records,
      new Set((existing ?? []).map((e: { measured_on: string }) => e.measured_on)),
    )
    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from('measurements').insert(
        inserts.map((i) => ({ ...i, type: 'weight', unit: 'lb', source: 'healthconnect' })),
      )
      if (insErr) throw insErr
      qc.invalidateQueries({ queryKey: ['measurements', 'weight'] })
      qc.invalidateQueries({ queryKey: ['latestWeight'] })
      qc.invalidateQueries({ queryKey: ['adaptiveTDEE'] })
    }
    // Only reached on success — a failed insert leaves the watermark so the
    // same records are retried on the next sync.
    const seen = maxRecordTime(records)
    if (seen) localStorage.setItem(WATERMARK_KEY, seen)
    return inserts.length
  } catch {
    return 0 // offline / RLS / migration not yet run — retry next app open
  } finally {
    inFlight = false
    lastRun = Date.now()
  }
}

/**
 * Weight-sync availability for the connect card. A zero-width read doubles as
 * the permission probe: 'ok' = connected, 'no_permission' = show Connect,
 * 'unavailable'/null (web, old APK, no Health Connect) = hide the card.
 */
export function useWeightSyncStatus() {
  return useQuery({
    queryKey: ['weightSyncStatus'],
    queryFn: async (): Promise<StepsStatus | null> => {
      const res = await readWeights(new Date().toISOString())
      return res?.status ?? null
    },
    enabled: Capacitor.isNativePlatform(),
    staleTime: 30_000,
  })
}

/** Ask for READ_WEIGHT, then run the first sync (30-day backfill) immediately. */
export function useConnectWeightSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const granted = await requestWeightPermission()
      if (!granted) return 0
      return syncWeightsFromHealthConnect(qc, { force: true })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['weightSyncStatus'] }),
  })
}

/** Manual "Sync now" for the connected state. */
export function useSyncWeightsNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => syncWeightsFromHealthConnect(qc, { force: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['weightSyncStatus'] }),
  })
}

/** Mount once (inside the authed tree): sync at boot and on foreground resume. */
export function useWeightSyncOnAppOpen() {
  const qc = useQueryClient()
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void syncWeightsFromHealthConnect(qc)
    const sub = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void syncWeightsFromHealthConnect(qc)
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [qc])
}
