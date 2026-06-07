import { useEffect, useRef, useState } from 'react'
import { Timer, Play, X, Minus, Plus, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'

const MIN = 15
const MAX = 600
const STEP = 15
const clamp = (s: number) => Math.max(MIN, Math.min(MAX, s))
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Two ascending beeps via WebAudio — no audio asset, no dependency. */
function playChime(ctx: AudioContext) {
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

/**
 * Sticky rest-timer bar for the active workout. The duration persists per
 * workout (via onChangeRest); the running countdown is ephemeral local state.
 * At zero: vibrate (Android) + visual flash, plus an optional chime toggle
 * (saved in localStorage, default off). The Start tap unlocks audio for iOS.
 */
export function RestTimer({
  restSeconds,
  onChangeRest,
}: {
  restSeconds: number
  onChangeRest: (sec: number) => void
}) {
  const [dur, setDur] = useState(restSeconds)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [total, setTotal] = useState(restSeconds)
  const [done, setDone] = useState(false)
  const [sound, setSound] = useState(
    () => localStorage.getItem('rest_chime') === '1',
  )

  const ctxRef = useRef<AudioContext | null>(null)
  const persistRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const running = remaining != null

  // Keep the configured duration in sync if the persisted value changes.
  useEffect(() => setDur(restSeconds), [restSeconds])

  // Countdown tick.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemaining((r) => (r == null ? null : Math.max(0, r - 1)))
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  // Reached zero → alert + reset to idle with a brief "done" flash.
  useEffect(() => {
    if (remaining !== 0) return
    navigator.vibrate?.([200, 100, 200])
    if (sound && ctxRef.current) playChime(ctxRef.current)
    setRemaining(null)
    setDone(true)
    const t = setTimeout(() => setDone(false), 4000)
    return () => clearTimeout(t)
  }, [remaining, sound])

  useEffect(() => () => void ctxRef.current?.close(), [])

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
    setTotal(dur)
    setRemaining(dur)
  }

  const bump = (delta: number) => {
    if (running) {
      const nv = Math.max(0, (remaining ?? 0) + delta)
      setRemaining(nv)
      if (nv > total) setTotal(nv)
    } else {
      const nv = clamp(dur + delta)
      setDur(nv)
      persist(nv)
    }
  }

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    localStorage.setItem('rest_chime', next ? '1' : '0')
    if (next) {
      const ctx = ensureCtx()
      if (ctx) playChime(ctx) // preview confirms it works + unlocks audio
    }
  }

  const pct = running && total ? Math.min(1, (remaining ?? 0) / total) : 0

  return (
    <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur transition-colors',
          done && 'animate-pulse border-primary bg-primary/15',
        )}
      >
        {running && (
          <div
            className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct * 100}%` }}
          />
        )}
        <div className="relative flex items-center gap-2 p-2">
          {!running ? (
            <>
              <Timer className="h-5 w-5 shrink-0 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">
                {done ? 'Rest done' : 'Rest'}
              </span>
              <button
                onClick={() => bump(-STEP)}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label="Less rest"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-base font-bold tabular-nums">
                {fmt(dur)}
              </span>
              <button
                onClick={() => bump(STEP)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label="More rest"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={start}
                className="flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground active:scale-95"
              >
                <Play className="h-4 w-4" /> Start
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
              <span className="flex-1 text-center text-2xl font-bold tabular-nums">
                {fmt(remaining ?? 0)}
              </span>
              <button
                onClick={() => bump(STEP)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-input active:bg-accent"
                aria-label="Add 15 seconds"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setRemaining(null)}
                className="flex h-8 items-center gap-1 rounded-md border border-input px-3 text-sm font-medium active:bg-accent"
              >
                <X className="h-4 w-4" /> Skip
              </button>
            </>
          )}
          <button
            onClick={toggleSound}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md active:bg-accent',
              sound ? 'text-primary' : 'text-muted-foreground',
            )}
            aria-label={sound ? 'Mute chime' : 'Enable chime'}
          >
            {sound ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
