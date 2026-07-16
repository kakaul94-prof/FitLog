import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import type { GeoFix } from '@/lib/geo'

// Cross-platform position stream for the walk recorder. On a native build with
// the plugin present, it uses @capacitor-community/background-geolocation — a
// foreground service that keeps delivering fixes with the screen off (a
// persistent notification is shown while active). Everywhere else (the browser
// PWA, an older APK) it falls back to navigator.geolocation, which only tracks
// in the foreground with the screen on — enough to test the UI + distance math
// without an APK. Every native call is gated on the plugin actually being
// present, like capture.ts.
//
// This plugin ships only native code + types (no JS wrapper), so we register it
// ourselves. registerPlugin is a no-op proxy on the web — safe to call at module
// load; the proxy only throws if a method runs on a platform without it, which
// canBackgroundGeo() guards against.
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  'BackgroundGeolocation',
)

export const canBackgroundGeo = () =>
  Capacitor.isNativePlatform() &&
  Capacitor.isPluginAvailable('BackgroundGeolocation')

export interface GeoWatcher {
  stop: () => void
}

export interface GeoWatchHandlers {
  onFix: (fix: GeoFix) => void
  /** Fatal error (permission denied / no GPS); recording can't continue. */
  onError: (message: string) => void
}

/** Open the OS app settings so the user can grant location (native only). */
export async function openLocationSettings(): Promise<void> {
  if (!canBackgroundGeo()) return
  await BackgroundGeolocation.openSettings()
}

/**
 * Start streaming position fixes. Returns a watcher whose `stop()` tears down
 * the native service or the browser watch. Defining `backgroundMessage` is what
 * makes the plugin keep running in the background.
 */
export async function startGeoWatch({
  onFix,
  onError,
}: GeoWatchHandlers): Promise<GeoWatcher> {
  if (canBackgroundGeo()) {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Recording your walk',
        backgroundMessage: 'FitLog is tracking your distance.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      (location, error) => {
        if (error) {
          onError(
            error.code === 'NOT_AUTHORIZED'
              ? 'Location permission is off. Enable it to record your walk.'
              : error.message || 'GPS error.',
          )
          return
        }
        if (location)
          onFix({
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy ?? 9999,
            t: location.time ?? Date.now(),
          })
      },
    )
    return {
      stop: () => {
        void BackgroundGeolocation.removeWatcher({ id })
      },
    }
  }

  // Web fallback — foreground/screen-on only.
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    onError('This device has no GPS available.')
    return { stop: () => {} }
  }
  const wid = navigator.geolocation.watchPosition(
    (p) =>
      onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy ?? 9999,
        t: p.timestamp,
      }),
    (e) =>
      onError(
        e.code === e.PERMISSION_DENIED
          ? 'Location permission was denied.'
          : 'Could not get a GPS signal.',
      ),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )
  return { stop: () => navigator.geolocation.clearWatch(wid) }
}
