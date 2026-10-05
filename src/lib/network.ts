import { onlineManager } from '@tanstack/react-query'
import { Network } from '@capacitor/network'

// Drive TanStack Query's online state from Capacitor Network — native when the
// plugin is in the APK, otherwise its web implementation falls back to
// navigator.onLine + window online/offline events. With networkMode 'online'
// (the default), this makes queries/mutations PAUSE while offline and auto-
// resume on reconnect, which is the write queue for warm-offline (Phase 2).
export function setupOnlineManager() {
  onlineManager.setEventListener((setOnline) => {
    Network.getStatus()
      .then((s) => setOnline(s.connected))
      .catch(() => {})
    const handle = Network.addListener('networkStatusChange', (s) =>
      setOnline(s.connected),
    )
    return () => {
      handle.then((h) => h.remove()).catch(() => {})
    }
  })
}
