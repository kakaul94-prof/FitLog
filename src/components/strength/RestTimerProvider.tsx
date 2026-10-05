import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  closeRestNotification,
  getChime,
  getNotify,
  notifyPhone,
  playChime,
  scheduleRestNotification,
} from '@/lib/restTimer'
import {
  cancelNativeRest,
  isNativeApp,
  startNativeRest,
} from '@/lib/restTimerNative'

const MIN = 15
const MAX = 600
const clamp = (s: number) => Math.max(MIN, Math.min(MAX, s))

interface RestTimerState {
  dur: number
  remaining: number
  total: number
  done: boolean
  running: boolean
  isPaused: boolean
  active: boolean
  display: number
  /** true while a workout page is mounted — shows the idle (configure) bar. */
  registered: boolean
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  bump: (delta: number) => void
  setDur: (sec: number) => void
}

interface RestTimerControls {
  register: (restSeconds: number, onChangeRest: (sec: number) => void) => void
  unregister: () => void
}

const StateContext = createContext<RestTimerState | null>(null)
// Split so the workout page can register its rest duration without subscribing
// to the per-second countdown ticks (controls are stable, state is volatile).
const ControlsContext = createContext<RestTimerControls | null>(null)

/**
 * App-root provider for the rest timer. Owns the countdown so it survives route
 * changes — the bar is rendered once globally (see RestTimerBar) and the active
 * workout page registers its per-workout rest duration via useRegisterRestTimer.
 * The countdown is wall-clock based, so it stays accurate when backgrounded.
 */
export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [dur, setDurState] = useState(90)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [paused, setPaused] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(90)
  const [total, setTotal] = useState(90)
  const [done, setDone] = useState(false)
  const [registered, setRegistered] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const persistRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onChangeRestRef = useRef<((sec: number) => void) | null>(null)
  // Latest values for reads inside stable callbacks without stale closures.
  const durRef = useRef(dur)
  durRef.current = dur
  const endsAtRef = useRef(endsAt)
  endsAtRef.current = endsAt
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  // True while the OS holds a scheduled completion banner (Notification
  // Triggers); the tick's notifyPhone() fallback then stands down so we don't
  // double-alert when the page wakes.
  const triggerScheduledRef = useRef(false)

  const running = endsAt != null
  const isPaused = paused != null
  const active = running || isPaused
  const display = isPaused ? (paused ?? 0) : remaining

  // Countdown driven by wall-clock time so it stays accurate when the tab is
  // backgrounded/throttled; recompute immediately on return to foreground.
  // Reaching zero → vibrate + optional chime + optional notification + flash.
  useEffect(() => {
    if (endsAt == null) return
    let fired = false
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemaining(rem)
      if (rem > 0) return
      if (fired) return
      fired = true
      // On native with notifications on, the RestTimer plugin owns the end alert
      // (vibrate + music duck + banner) so it fires even when backgrounded — skip
      // the JS alerts here to avoid doubling up.
      if (!(isNativeApp() && getNotify())) {
        navigator.vibrate?.([200, 100, 200])
        if (getChime() && ctxRef.current) playChime(ctxRef.current)
        if (getNotify() && !triggerScheduledRef.current) notifyPhone()
      }
      setEndsAt(null)
      setDone(true)
      clearTimeout(flashRef.current)
      flashRef.current = setTimeout(() => setDone(false), 4000)
    }
    tick()
    const id = setInterval(tick, 1000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [endsAt])

  // Hand the completion banner to the OS so it fires on time even while the page
  // is frozen (screen locked / backgrounded), where the countdown above is
  // throttled. Chrome/Android only; elsewhere this is a no-op and the tick's
  // notifyPhone() fallback runs. Re-runs on bump/resume (endsAt dep); the
  // pending banner is cancelled in pause/stop via closeRestNotification.
  useEffect(() => {
    if (endsAt == null) return
    // Native app (notifications on): the RestTimer plugin shows the live
    // system-ticked countdown and arms the end alarm (works backgrounded). It
    // updates in place on bump; pause()/stop() cancel it explicitly.
    if (isNativeApp() && getNotify()) {
      void startNativeRest(endsAt)
      return
    }
    // Web/PWA: hand the completion banner to the OS via Notification Triggers
    // (Chrome/Android) when supported, so it lands on time while frozen.
    let cancelled = false
    void scheduleRestNotification(endsAt).then((ok) => {
      if (!cancelled) triggerScheduledRef.current = ok
    })
    return () => {
      cancelled = true
    }
  }, [endsAt])

  useEffect(
    () => () => {
      void ctxRef.current?.close()
      clearTimeout(flashRef.current)
      clearTimeout(persistRef.current)
    },
    [],
  )

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) ctxRef.current = new Ctx()
    }
    if (ctxRef.current?.state === 'suspended') void ctxRef.current.resume()
  }, [])

  const start = useCallback(() => {
    ensureCtx() // unlock audio on the user gesture (needed for iOS)
    const d = durRef.current
    setDone(false)
    clearTimeout(flashRef.current)
    setPaused(null)
    setTotal(d)
    setRemaining(d)
    setEndsAt(Date.now() + d * 1000)
  }, [ensureCtx])

  // Pause freezes the remaining seconds and stops the tick; resume re-anchors
  // the wall-clock end time so the countdown continues from where it left off.
  const pause = useCallback(() => {
    const e = endsAtRef.current
    if (e == null) return
    const rem = Math.max(0, Math.ceil((e - Date.now()) / 1000))
    setPaused(rem)
    setRemaining(rem)
    setEndsAt(null)
    triggerScheduledRef.current = false
    closeRestNotification() // cancel the scheduled completion banner
    void cancelNativeRest()
  }, [])
  const resume = useCallback(() => {
    const p = pausedRef.current
    if (p == null) return
    ensureCtx()
    setEndsAt(Date.now() + p * 1000)
    setPaused(null)
  }, [ensureCtx])
  const stop = useCallback(() => {
    setEndsAt(null)
    setPaused(null)
    triggerScheduledRef.current = false
    closeRestNotification()
    void cancelNativeRest()
  }, [])

  const setDur = useCallback((sec: number) => {
    const nv = clamp(sec)
    setDurState(nv)
    clearTimeout(persistRef.current)
    persistRef.current = setTimeout(() => onChangeRestRef.current?.(nv), 500)
  }, [])

  const bump = useCallback(
    (delta: number) => {
      if (endsAtRef.current != null) {
        const ne = Math.max(Date.now(), endsAtRef.current + delta * 1000)
        setEndsAt(ne)
        const rem = Math.max(0, Math.ceil((ne - Date.now()) / 1000))
        setRemaining(rem)
        setTotal((t) => (rem > t ? rem : t))
      } else if (pausedRef.current != null) {
        const nv = Math.max(0, pausedRef.current + delta)
        setPaused(nv)
        setRemaining(nv)
        setTotal((t) => (nv > t ? nv : t))
      } else {
        setDur(durRef.current + delta)
      }
    },
    [setDur],
  )

  const register = useCallback(
    (restSeconds: number, onChangeRest: (sec: number) => void) => {
      onChangeRestRef.current = onChangeRest
      setRegistered(true)
      // Adopt the workout's configured rest as the duration (harmless while a
      // countdown runs — that uses endsAt, not dur).
      setDurState(clamp(restSeconds))
    },
    [],
  )
  const unregister = useCallback(() => {
    onChangeRestRef.current = null
    setRegistered(false)
  }, [])

  const state: RestTimerState = {
    dur,
    remaining,
    total,
    done,
    running,
    isPaused,
    active,
    display,
    registered,
    start,
    pause,
    resume,
    stop,
    bump,
    setDur,
  }
  const controls = useMemo<RestTimerControls>(
    () => ({ register, unregister }),
    [register, unregister],
  )

  return (
    <ControlsContext.Provider value={controls}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ControlsContext.Provider>
  )
}

export function useRestTimer(): RestTimerState {
  const ctx = useContext(StateContext)
  if (!ctx) throw new Error('useRestTimer must be used within RestTimerProvider')
  return ctx
}

/** Register the active workout's rest duration + persistence callback while the
 *  workout page is mounted. Pass `undefined` until the workout has loaded. */
export function useRegisterRestTimer(
  restSeconds: number | undefined,
  onChangeRest: (sec: number) => void,
) {
  const ctx = useContext(ControlsContext)
  if (!ctx)
    throw new Error('useRegisterRestTimer must be used within RestTimerProvider')
  const { register, unregister } = ctx
  useEffect(() => {
    if (restSeconds == null) return
    register(restSeconds, onChangeRest)
    return () => unregister()
  }, [restSeconds, onChangeRest, register, unregister])
}
