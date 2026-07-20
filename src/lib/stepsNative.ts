// Bridge to the native StepCounter plugin (Android, read-only Health Connect).
// On web — and on older APKs that predate the plugin — every call is a guarded
// no-op that returns null, so the PWA behaves exactly as before.
import { Capacitor, registerPlugin } from '@capacitor/core'

export type StepsStatus = 'ok' | 'no_permission' | 'unavailable'

export interface StepsReadResult {
  status: StepsStatus
  /** Present only when status === 'ok'. */
  steps?: number
}

interface StepCounterPlugin {
  readSteps(options: { date: string }): Promise<StepsReadResult>
  requestPermissions(): Promise<{ granted: boolean }>
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
