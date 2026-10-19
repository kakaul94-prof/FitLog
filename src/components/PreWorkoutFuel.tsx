import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, UtensilsCrossed, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TimeInput } from '@/components/ui/time-input'
import { cn } from '@/lib/utils'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useDiary } from '@/features/diary/useDiary'
import { timeLabel, todayISO } from '@/lib/date'
import {
  formatMinutes,
  gapMinutes,
  pendingFuelMeal,
  preWorkoutWindow,
  recordFuelFeedback,
  rememberFuelMeal,
} from '@/lib/fuel'
import type { DiaryEntry, FuelFeel, FuelTimingState, Meal } from '@/lib/database.types'

const MEALS: { key: Meal; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
]

const FEELS: { key: FuelFeel; label: string }[] = [
  { key: 'heavy', label: 'Heavy' },
  { key: 'fine', label: 'Fine' },
  { key: 'flat', label: 'Hungry/flat' },
]

const pill = 'rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'
const kcalOf = (e: DiaryEntry) => (e.nutrients.kcal ?? 0) * e.servings
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const clockAt = (ateAt: string, min: number) =>
  timeLabel(new Date(new Date(ateAt).getTime() + min * 60_000).toISOString())

// h:mm with no AM/PM, so the full window fits under the tile's icon.
const shortClockAt = (ateAt: string, min: number) => {
  const d = new Date(new Date(ateAt).getTime() + min * 60_000)
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`
}

// Lift tab tile: pick today's pre-workout meal from the diary and get a comfort
// window to train in (lib/fuel.ts). Reads "Fuel" until a meal is timed.
export function PreWorkoutFuelTile({ className }: { className?: string }) {
  const { data: profile } = useProfile()
  const today = todayISO()
  const { data: entries } = useDiary(today)
  const [open, setOpen] = useState(false)
  const state = profile?.fuel_timing ?? null
  const last = state?.last && todayISO(new Date(state.last.ateAt)) === today ? state.last : null
  const picked = useMemo(
    () => (last && entries ? entries.filter((e) => last.entryIds.includes(e.id)) : []),
    [last, entries],
  )
  const w = picked.length ? preWorkoutWindow(picked, state?.offsetMin ?? 0) : null

  const timed =
    last && w
      ? {
          label: `${shortClockAt(last.ateAt, w.earliestMin)}–${shortClockAt(last.ateAt, w.latestMin)}`,
          aria: `Pre-workout fuel: train ${clockAt(last.ateAt, w.earliestMin)} to ${clockAt(last.ateAt, w.latestMin)}`,
        }
      : null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={profile === undefined}
        aria-label={timed?.aria ?? 'Time your pre-workout meal'}
        className={cn(className, timed && 'bg-primary/15 font-medium text-primary active:bg-primary/25')}
      >
        <UtensilsCrossed className={cn('h-5 w-5', timed ? 'text-primary' : 'text-foreground')} />
        {timed?.label ?? 'Fuel'}
      </button>
      {open && (
        <FuelSheet entries={entries ?? []} state={state} initial={last} today={today} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function FuelSheet({
  entries,
  state,
  initial,
  today,
  onClose,
}: {
  entries: DiaryEntry[]
  state: FuelTimingState | null
  initial: FuelTimingState['last']
  today: string
  onClose: () => void
}) {
  const update = useUpdateProfile()
  const [ids, setIds] = useState<string[]>(initial?.entryIds ?? [])
  // null = follow the default (when the picked foods were logged).
  const [time, setTime] = useState<string | null>(initial ? hhmm(initial.ateAt) : null)
  const chosen = entries.filter((e) => ids.includes(e.id))
  const nowISO = new Date().toISOString()
  const loggedAt = chosen.reduce<string | null>((a, e) => (a && a > e.created_at ? a : e.created_at), null)
  // A log time from another day (pre-logged, copied) or ahead of now isn't
  // when you ate, so fall back to now.
  const loggedToday = loggedAt && loggedAt <= nowISO && todayISO(new Date(loggedAt)) === today
  const shown = time ?? hhmm(loggedToday ? loggedAt : nowISO)
  const ateAtMs = new Date(`${today}T${shown}`).getTime()
  const future = ateAtMs > Date.now()
  const total = Math.round(chosen.reduce((s, e) => s + kcalOf(e), 0))
  // Live preview of the window, so the reasons the old card listed still
  // show somewhere now that the tile only carries the times.
  const ateISO = new Date(ateAtMs).toISOString()
  const preview = chosen.length && !future ? preWorkoutWindow(chosen, state?.offsetMin ?? 0) : null

  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const save = () => {
    const w = preWorkoutWindow(chosen, state?.offsetMin ?? 0)
    if (!w || future) return
    update.mutate({ fuel_timing: rememberFuelMeal(state, new Date(ateAtMs).toISOString(), ids, w) }, { onSuccess: onClose })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="max-h-[80svh] space-y-3 overflow-y-auto p-4 text-left text-foreground">
          <p className="font-semibold">Pick your pre-workout meal</p>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing logged today yet. Log your meal in the Diary first.</p>
          ) : (
            MEALS.map(({ key, label }) => {
              const rows = entries.filter((e) => e.meal === key)
              if (!rows.length) return null
              return (
                <div key={key}>
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  {rows.map((e) => {
                    const on = ids.includes(e.id)
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggle(e.id)}
                        className="flex w-full items-center gap-2 border-b border-border py-2 text-left text-sm last:border-0"
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-primary',
                            on && 'bg-primary text-primary-foreground',
                          )}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{e.food_name}</span>
                        <span className="text-muted-foreground">{Math.round(kcalOf(e))}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
          <label className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Ate at</span>
            <TimeInput
              value={shown}
              onChange={(ev) => setTime(ev.target.value || null)}
              className={cn(
                'rounded-md border bg-background px-2 py-1',
                future ? 'border-destructive' : 'border-border',
              )}
            />
          </label>
          {future ? (
            <p className="text-xs text-destructive">That's later than now. Set when you actually ate.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Defaults to when you logged it, or now if it was logged ahead of time</p>
          )}
          {preview && (
            <div className="space-y-1 rounded-lg bg-primary/10 p-2.5">
              <p className="text-sm font-semibold text-primary">
                Train {clockAt(ateISO, preview.earliestMin)} – {clockAt(ateISO, preview.latestMin)}
              </p>
              <p className="text-xs text-muted-foreground">Best around {clockAt(ateISO, preview.bestMin)}</p>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                {preview.reasons.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </div>
          )}
          {update.isError && <p className="text-xs text-destructive">Couldn't save. Try again.</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} disabled={total <= 0 || future || update.isPending}>
              {update.isPending ? 'Saving…' : `Time my workout · ${total} kcal`}
            </Button>
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}

// Workout page: once per timed meal, ask how the stomach felt. Answers that
// contradict the window shift future windows ±15 min (nextOffset).
export function FuelFeedbackPrompt({ startedAt }: { startedAt: string }) {
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const state = profile?.fuel_timing ?? null
  const last = pendingFuelMeal(state, startedAt)
  if (!state || !last) return null
  const gap = gapMinutes(last.ateAt, startedAt)

  const answer = (feel: FuelFeel) =>
    update.mutate({ fuel_timing: recordFuelFeedback(state, feel, gap, todayISO()) })
  const skip = () => update.mutate({ fuel_timing: { ...state, last: null } })

  return (
    <Card className="space-y-2 border-primary/40 p-3 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">How's your stomach?</p>
          <p className="text-xs text-muted-foreground">
            {last.kcal} kcal eaten {formatMinutes(gap)} before you started
          </p>
        </div>
        <button type="button" onClick={skip} aria-label="Skip" className="text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-1.5">
        {FEELS.map((f) => (
          <button
            key={f.key}
            type="button"
            disabled={update.isPending}
            onClick={() => answer(f.key)}
            className={cn(pill, 'flex-1 py-1.5 text-center disabled:opacity-50')}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Shifts your future windows by ±15 min</p>
    </Card>
  )
}
