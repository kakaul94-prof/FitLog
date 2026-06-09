import { useEffect, useRef, useState } from 'react'
import { Timer, Play, Pause, X, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getChime, getNotify, notifyPhone, playChime } from '@/lib/restTimer'

const MIN = 15
const MAX = 600
const STEP = 15
const clamp = (s: number) => Math.max(MIN, Math.min(MAX, s))
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Sticky rest-timer bar for the active workout. The duration persists per
 * workout (via onChangeRest); the running countdown is ephemeral local state
 * driven by a wall-clock end time so it stays accurate when the tab is
 * backgrounded/throttled. At zero: vibrate (Android) + visual flash, plus an
 * optional chime and/or phone notification (both toggled in More → Rest timer).
 * Pause freezes the remaining time; the Start/Resume tap unlocks audio for iOS.
 */
export function RestTimer({
  restSeconds,
  onChangeRest,
}: {
  restSeconds: number
  onChangeRest: (sec: number) => void
}) {
  const [dur, setDur] = useState(restSeconds)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [paused, setPaused] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(restSeconds)
  const [total, setTotal] = useState(restSeconds)
  const [done, setDone] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const ctxRef = useRef<AudioContext | null>(null)
  const persistRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = endsAt != null
  const isPaused = paused != null
  const active = running || isPaused
  const display = isPaused ? (paused ?? 0) : remaining

  // Keep the configured duration in sync if the persisted value changes.
  useEffect(() => setDur(restSeconds), [restSeconds])

  // Countdown driven by wall-clock time so it stays accurate when the tab is
  // backgrounded/throttled; recompute immediately on return to foreground.
  // Reaching zero → vibrate + optional chime + optional notification + flash.
  useEffect(() => {
    if (endsAt == null) return
    let fired = false
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemaining(rem)
      if (rem > 0 || fired) return
      fired = true
      navigator.vibrate?.([200, 100, 200])
      if (getChime() && ctxRef.current) playChime(ctxRef.current)
      if (getNotify()) notifyPhone()
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

  useEffect(
    () => () => {
      void ctxRef.current?.close()
      clearTimeout(flashRef.current)
    },
    [],
  )

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) ctxRef.current = new Ctx()
    }
    if (ctxRef.current?.state === 'suspended') void ctxRef.current.resume()
    return ctxRef.current
  }

  const persist = (sec: number) => {
    clearTimeout(persistRef.current)
    persistRef.current = setTimeout(() => onChangeRest(sec), 500)
  }

  const start = () => {
    ensureCtx() // unlock audio on the user gesture (needed for iOS)
    setDone(false)
    clearTimeout(flashRef.current)
    setPaused(null)
    setTotal(dur)
    setRemaining(dur)
    setEndsAt(Date.now() + dur * 1000)
  }

  // Pause freezes the remaining seconds and stops the tick; resume re-anchors
  // the wall-clock end time so the countdown continues from where it left off.
  const pause = () => {
    if (endsAt == null) return
    const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
    setPaused(rem)
    setRemaining(rem)
    setEndsAt(null)
  }
  const resume = () => {
    if (paused == null) return
    ensureCtx()
    setEndsAt(Date.now() + paused * 1000)
    setPaused(null)
  }
  const stop = () => {
    setEndsAt(null)
    setPaused(null)
  }

  // Tap the time to type a new rest duration. Accepts raw seconds ("90") or
  // "m:ss" (handy on desktop); mobile gets a numeric keypad for the seconds.
  const beginEdit = () => {
    setDraft(String(dur))
    setEditing(true)
  }
  const commitEdit = () => {
    const t = draft.trim()
    let sec = dur
    if (t.includes(':')) {
      const [m, s] = t.split(':')
      sec = (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0)
    } else if (t !== '') {
      const n = parseInt(t, 10)
      if (Number.isFinite(n)) sec = n
    }
    const nv = clamp(sec)
    setDur(nv)
    persist(nv)
    setEditing(false)
  }

  const bump = (delta: number) => {
    if (running) {
      const ne = Math.max(Date.now(), (endsAt ?? Date.now()) + delta * 1000)
      setEndsAt(ne)
      const rem = Math.max(0, Math.ceil((ne - Date.now()) / 1000))
      setRemaining(rem)
      if (rem > total) setTotal(rem)
    } else if (isPaused) {
      const nv = Math.max(0, (paused ?? 0) + delta)
      setPaused(nv)
      setRemaining(nv)
      if (nv > total) setTotal(nv)
    } else {
      const nv = clamp(dur + delta)
      setDur(nv)
      persist(nv)
    }
  }

  const pct = active && total ? Math.min(1, display / total) : 0

  return (
    <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur transition-colors',
          done && 'animate-pulse border-primary bg-primary/15',
        )}
      >
        {active && (
          <div
            className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct * 100}%` }}
          />
        )}
        <div className="relative flex items-center gap-2 p-2">
          {!active ? (
            <>
              <Timer className="h-5 w-5 shrink-0 text-primary" />
              {editing ? (
                <input
                  autoFocus
                  inputMode="numeric"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    else if (e.key === 'Escape') setEditing(false)
                  }}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1 text-center text-base font-bold tabular-nums outline-none focus:border-primary"
                  aria-label="Rest seconds"
                />
              ) : (
                <button
                  onClick={beginEdit}
                  className="rounded-md px-2 py-1 text-base font-bold tabular-nums active:bg-accent"
                  aria-label="Edit rest time"
                >
                  {fmt(dur)}
                </button>
              )}
              <button
                onClick={start}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground active:scale-95"
                aria-label="Start rest"
              >
                <Play className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => bump(-STEP)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label="Subtract 15 seconds"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span
                className={cn(
                  'min-w-0 flex-1 text-center text-2xl font-bold tabular-nums',
                  isPaused && 'text-muted-foreground',
                )}
              >
                {fmt(display)}
              </span>
              <button
                onClick={() => bump(STEP)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label="Add 15 seconds"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={isPaused ? resume : pause}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label={isPaused ? 'Resume rest' : 'Pause rest'}
              >
                {isPaused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={stop}
                className="flex h-8 items-center gap-1 rounded-md border border-input px-3 text-sm font-medium active:bg-accent"
              >
                <X className="h-4 w-4" /> Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
