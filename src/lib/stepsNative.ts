// Bridge to the native StepCounter plugin (Android, read-only Health Connect).
// On web — and on older APKs that predate the plugin — every call is a guarded
// no-op that returns null, so the PWA behaves exactly as before.
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { HCWeightRecord } from './weightSync'

export type StepsStatus = 'ok' | 'no_permission' | 'unavailable'

export interface StepsReadResult {
  status: StepsStatus
  /** Present only when status === 'ok'. */
  steps?: number
}

export interface WeightsReadResult {
  status: StepsStatus
  /** Present only when status === 'ok'. */
  records?: HCWeightRecord[]
}

interface StepCounterPlugin {
  readSteps(options: { date: string }): Promise<StepsReadResult>
  readWeights(options: { since: string }): Promise<WeightsReadResult>
  requestPermissions(options?: { scope?: 'steps' | 'weight' }): Promise<{ granted: boolean }>
}

const StepCounter = registerPlugin<StepCounterPlugin>('StepCounter')

/** Read the step total for a day ("yyyy-MM-dd"). null = web / plugin missing. */
export async function readSteps(date: string): Promise<StepsReadResult | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await StepCounter.readSteps({ date })
  } catch {
    return null // plugin missing (older APK)
  }
}

/**
 * Read weight records at/after an ISO instant. null = web / plugin missing, and
 * on APKs that predate readWeights the rejected call also lands here — so a
 * null means "hide weight sync entirely".
 */
export async function readWeights(since: string): Promise<WeightsReadResult | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await StepCounter.readWeights({ since })
  } catch {
    return null // plugin missing (older APK)
  }
}

/** Trigger Health Connect's grant screen; resolves true once READ_STEPS is granted. */
export async function requestStepsPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { granted } = await StepCounter.requestPermissions()
    return granted
  } catch {
    return false
  }
}

/** Trigger Health Connect's grant screen for READ_WEIGHT; resolves true when granted. */
export async function requestWeightPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { granted } = await StepCounter.requestPermissions({ scope: 'weight' })
    return granted
  } catch {
    return false
  }
}
