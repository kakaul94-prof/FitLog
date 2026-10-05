// Rest-timer audio + phone-notification preferences and helpers.
// Preferences are simple on/off flags in localStorage, configured in
// More → Rest timer and consumed by the RestTimer bar at zero.

const CHIME_KEY = 'rest_chime'
const NOTIFY_KEY = 'rest_notify'

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    /* localStorage unavailable */
  }
}

export const getChime = () => read(CHIME_KEY)
export const setChime = (on: boolean) => write(CHIME_KEY, on)
export const getNotify = () => read(NOTIFY_KEY)
export const setNotify = (on: boolean) => write(NOTIFY_KEY, on)

export const notifySupported = () =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator

/** Two ascending beeps via WebAudio — no audio asset, no dependency. */
export function playChime(ctx: AudioContext) {
  const t0 = ctx.currentTime
  const beep = (offset: number, freq: number) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t0 + offset)
    gain.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0 + offset)
    osc.stop(t0 + offset + 0.26)
  }
  beep(0, 880)
  beep(0.32, 1175)
}

function makeCtx(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  return Ctx ? new Ctx() : null
}

/** One-off preview chime for the settings toggle. Spins up a transient context,
 *  plays, then closes it — must be called from a user gesture on iOS. */
export function previewChime() {
  const ctx = makeCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  playChime(ctx)
  setTimeout(() => void ctx.close(), 800)
}

/**
 * System notification on the phone when rest ends. Uses the service-worker
 * registration (required on Android — `new Notification()` throws there),
 * falling back to a plain Notification on desktop. Android delivers reliably
 * while the app is foreground/recently-active; a fully-closed or locked phone
 * is a web-platform limit. iOS needs the PWA installed to the home screen.
 */
export function notifyPhone(
  title = 'Rest complete',
  body = 'Time for your next set 💪',
) {
  if (!notifySupported() || Notification.permission !== 'granted') return
  const opts = {
    body,
    tag: 'fitlog-rest',
    renotify: true,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    vibrate: [200, 100, 200],
  } as NotificationOptions
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, opts))
    .catch(() => {
      try {
        new Notification(title, opts)
      } catch {
        /* notifications unavailable */
      }
    })
}

/** Notification Triggers (TimestampTrigger) — Chrome/Android only; lets the OS
 *  fire a future-dated notification even while the page is frozen. */
declare const TimestampTrigger: { new (timestamp: number): unknown }
const triggersSupported = () =>
  typeof window !== 'undefined' && 'TimestampTrigger' in window

/**
 * Schedule the "Rest complete" banner to fire at `endsAt` via the OS, so it
 * lands on time even while the page is frozen (screen locked / backgrounded),
 * where the JS countdown is throttled and would otherwise fire late. Chrome on
 * Android only; returns false when unsupported so the caller keeps the JS-timer
 * fallback. Shares the 'fitlog-rest' tag, so closeRestNotification() cancels it.
 */
export async function scheduleRestNotification(
  endsAt: number,
): Promise<boolean> {
  if (
    !getNotify() ||
    !notifySupported() ||
    !triggersSupported() ||
    Notification.permission !== 'granted'
  )
    return false
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('Rest complete', {
      body: 'Time for your next set 💪',
      tag: 'fitlog-rest',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      vibrate: [200, 100, 200],
      showTrigger: new TimestampTrigger(endsAt),
    } as NotificationOptions)
    return true
  } catch {
    return false
  }
}

/** Dismiss the rest notification — shown or scheduled (timer stopped/skipped). */
export function closeRestNotification() {
  if (!notifySupported()) return
  navigator.serviceWorker.ready
    .then(async (reg) => {
      for (const n of await reg.getNotifications({
        tag: 'fitlog-rest',
        includeTriggered: true,
      } as GetNotificationOptions))
        n.close()
    })
    .catch(() => {
      /* notifications unavailable */
    })
}

/** Request notification permission (from a user gesture) and report whether it
 *  ended up granted. */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!notifySupported()) return false
  let perm = Notification.permission
  if (perm === 'default') perm = await Notification.requestPermission()
  return perm === 'granted'
}
