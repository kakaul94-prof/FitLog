// Keep the Supabase session alive across app backgrounding on native.
//
// Supabase access tokens expire ~hourly; a long-lived refresh token mints new
// ones, but the auto-refresh timer only ticks while the WebView JS is alive and
// foregrounded. On a backgrounded/killed native app the timer stalls, so on
// reopen an expired access token + a refresh race can bounce you to the login
// screen. The documented mobile fix is to drive startAutoRefresh/stopAutoRefresh
// off the app's foreground state (Supabase's React-Native AppState pattern,
// ported to Capacitor's App plugin).
//
// Web is a no-op: the browser tab's own timer already refreshes while open, and
// the @capacitor/app web shim never emits appStateChange there.
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { supabase } from './supabase'

export function setupAuthRefresh(): void {
  if (!Capacitor.isNativePlatform()) return

  // Foreground at boot — start refreshing immediately (also forces a refresh if
  // the token expired while the app was closed).
  void supabase.auth.startAutoRefresh()

  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void supabase.auth.startAutoRefresh()
    else void supabase.auth.stopAutoRefresh()
  })
}
