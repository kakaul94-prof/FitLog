// Bridge to the native RestTimer plugin (Android). On web, every call is a
// guarded no-op so the PWA behaves exactly as before. The try/catch also covers
// the live-URL case where an older installed APK lacks the plugin.
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface RestTimerNativePlugin {
  /** Post the ongoing countdown notification + arm the end alarm. */
  start(options: { endsAt: number }): Promise<void>
  /** Clear the notification + alarm (skip/stop/pause). */
  cancel(): Promise<void>
  /** Ask for POST_NOTIFICATIONS (Android 13+). */
  requestPermissions(): Promise<void>
}

const RestTimerNative = registerPlugin<RestTimerNativePlugin>('RestTimer')

/** True only inside the packaged native app. */
export const isNativeApp = () => Capacitor.isNativePlatform()

export async function startNativeRest(endsAt: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RestTimerNative.start({ endsAt })
  } catch {
    /* plugin missing (web / older APK) */
  }
}

export async function cancelNativeRest(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RestTimerNative.cancel()
  } catch {
    /* plugin missing */
  }
}

export async function requestNativeRestPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await RestTimerNative.requestPermissions()
  } catch {
    /* plugin missing */
  }
}
