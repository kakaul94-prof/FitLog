import { useState } from 'react'
import { Timer, Play, Pause, X, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRestTimer } from './RestTimerProvider'

const STEP = 15
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Global rest-timer bar, rendered once at the app root so a running countdown
 * survives navigation. Sits at the bottom edge on full-screen pages and just
 * above the bottom nav on tabbed pages (via the --rest-timer-bottom var set by
 * AppLayout). Hidden unless a rest is active or a workout page is open.
 */
export function RestTimerBar() {
  const {
    dur,
    total,
    done,
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
  } = useRestTimer()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!active && !registered) return null

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
    setDur(sec)
    setEditing(false)
  }

  const pct = active && total ? Math.min(1, display / total) : 0

  return (
    <div
      className="fixed left-1/2 z-30 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      style={{ bottom: 'var(--rest-timer-bottom, 0px)' }}
    >
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
