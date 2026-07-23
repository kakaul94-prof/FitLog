// Bridge to the native BiometricAuth plugin (Android) + the app-unlock setting.
// Level-1 privacy gate: verify the user before showing the UI. Verification
// only — no stored secrets; the Supabase session stays in its normal storage,
// and the app keeps a password fallback so a failed/absent biometric never
// bricks the device. Every call is a guarded no-op on web / older APKs (the
// PWA and pre-plugin builds simply never lock).
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'

export interface BiometricAuthPlugin {
  isAvailable(): Promise<{ available: boolean; status: number }>
  authenticate(options: {
    title?: string
    subtitle?: string
    cancelLabel?: string
  }): Promise<{ success: boolean; error?: string; code?: number; message?: string }>
}

const BiometricAuth = registerPlugin<BiometricAuthPlugin>('BiometricAuth')

const LOCK_KEY = 'fitlog:biometric-lock'

/** Whether the user has turned on biometric unlock (localStorage, per device). */
export function getBiometricLock(): boolean {
  try {
    return localStorage.getItem(LOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function setBiometricLock(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOCK_KEY, '1')
    else localStorage.removeItem(LOCK_KEY)
  } catch {
    /* ignore */
  }
}

/** True only when the packaged app runs on a device with usable biometrics. */
export async function biometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    return (await BiometricAuth.isAvailable()).available
  } catch {
    return false
  }
}

/** Show the system prompt; resolves true only on a successful scan. */
export async function biometricAuthenticate(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const r = await BiometricAuth.authenticate({
      title: 'Unlock FitLog',
      subtitle: "Confirm it's you",
      cancelLabel: 'Cancel',
    })
    return r.success
  } catch {
    return false
  }
}

/**
 * Run `cb` whenever the app returns to the foreground (native only; no-op on
 * web). Returns an unsubscribe. Used to re-lock on resume.
 */
export function onAppForeground(cb: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const handle = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) cb()
  })
  return () => {
    handle.then((h) => h.remove()).catch(() => {})
  }
}
