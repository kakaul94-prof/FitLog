import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Flame, Play, Square } from 'lucide-react'
import { findWarmupDrill } from '@/data/warmupDrills'
import { useWarmupTicks } from '@/features/mobility/useMobility'
import { clockLabel, minLabel } from '@/lib/mobility'
import { tickedDrills } from '@/lib/warmup'
import { cn } from '@/lib/utils'

/** The template's warm-up as a tick-off list at the top of a workout. Ticks
 *  bank time to the Mobility list's Warm-up item: the drill's estimate, or the
 *  real seconds for a hold run on its countdown. Collapses once all are done. */
export function WarmupChecklist({
  workoutId,
  date,
  drills,
}: {
  workoutId: string
  date: string
  drills: string[]
}) {
  const { state, tick, untick } = useWarmupTicks(workoutId, date)
  const banked = tickedDrills(state, workoutId)
  // Optimistic tick state while the profile save is in flight.
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const [timer, setTimer] = useState<{ drill: string; endsAt: number; holdSec: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const isDone = (k: string) => pending[k] ?? banked.has(k)
  const doneCount = drills.filter(isDone).length
  const allDone = doneCount === drills.length
  const open = openOverride ?? !allDone
  const bankedSec = drills.reduce((s, k) => s + (banked.get(k) ?? 0), 0)

  const set = (drill: string, done: boolean, seconds?: number) => {
    setPending((p) => ({ ...p, [drill]: done }))
    const sec = seconds ?? findWarmupDrill(drill)?.estSec ?? 60
    void Promise.resolve(done ? tick(drill, sec) : untick(drill)).finally(() =>
      setPending(({ [drill]: _, ...rest }) => rest),
    )
  }

  const stopTimer = (finished: boolean) => {
    if (!timer) return
    const left = Math.max(0, (timer.endsAt - Date.now()) / 1000)
    const held = finished ? timer.holdSec : timer.holdSec - left
    setTimer(null)
    if (held >= 1) set(timer.drill, true, held)
  }

  useEffect(() => {
    if (!timer) return
    const iv = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= timer.endsAt) stopTimer(true)
    }, 250)
    return () => clearInterval(iv)
  })

  if (drills.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <button
        onClick={() => setOpenOverride(!open)}
        className="flex w-full items-center gap-1.5 text-sm font-semibold"
      >
        <Flame className="h-4 w-4 text-primary" />
        <span className="flex-1 text-left">
          {allDone ? `Warm-up done · ${minLabel(bankedSec)}` : 'Warm-up'}
        </span>
        {!allDone && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {doneCount} / {drills.length}
          </span>
        )}
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <>
          <div className="mt-1 divide-y divide-border">
            {drills.map((k) => {
              const d = findWarmupDrill(k)
              const done = isDone(k)
              const running = timer?.drill === k
              return (
                <div key={k} className="flex items-center gap-2.5 py-2">
                  <button
                    aria-label={`${done ? 'Untick' : 'Tick'} ${d?.name ?? k}`}
                    onClick={() => set(k, !done)}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2',
                      done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                    )}
                  >
                    {done && <Check className="h-4 w-4" />}
                  </button>
                  <span
                    className={cn(
                      'min-w-0 flex-1 text-sm',
                      done && 'text-muted-foreground line-through',
                    )}
                  >
                    {d?.name ?? k}
                    {d && <span className="text-muted-foreground"> · {d.dose}</span>}
                  </span>
                  {d?.holdSec && !done &&
                    (running ? (
                      <button
                        onClick={() => stopTimer(false)}
                        className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium tabular-nums text-primary"
                      >
                        <Square className="h-3 w-3" />
                        {clockLabel((timer.endsAt - now) / 1000)}
                      </button>
                    ) : (
                      <button
                        aria-label={`Start ${d.name} timer`}
                        disabled={timer != null}
                        onClick={() => {
                          const t = Date.now()
                          setNow(t)
                          setTimer({ drill: k, endsAt: t + d.holdSec! * 1000, holdSec: d.holdSec! })
                        }}
                        className="rounded-md p-1 text-muted-foreground disabled:opacity-40"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    ))}
                </div>
              )
            })}
          </div>
          {bankedSec > 0 && (
            <p className="mt-1 rounded-md bg-primary/10 px-2 py-1.5 text-xs text-primary">
              {minLabel(bankedSec)} banked to Mobility
            </p>
          )}
        </>
      )}
    </div>
  )
}
