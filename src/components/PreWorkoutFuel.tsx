import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, UtensilsCrossed, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

// Lift tab: pick today's pre-workout meal from the diary and get a comfort
// window to train in (lib/fuel.ts). Collapses to one button until used.
export function PreWorkoutFuelCard() {
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

  if (profile === undefined) return null
  const sheet = open && (
    <FuelSheet entries={entries ?? []} state={state} initial={last} today={today} onClose={() => setOpen(false)} />
  )

  if (!last || !w) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm font-medium active:bg-accent"
        >
          <UtensilsCrossed className="h-4 w-4 text-primary" /> Time your pre-workout meal
        </button>
        {sheet}
      </>
    )
  }

  return (
    <Card className="space-y-2 p-3 text-left text-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold">
          <UtensilsCrossed className="h-4 w-4 text-primary" /> Pre-workout fuel
        </span>
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-primary">
          Change
        </button>
      </div>
      <div>
        <p className="text-lg font-bold">
          Train {clockAt(last.ateAt, w.earliestMin)} – {clockAt(last.ateAt, w.latestMin)}
        </p>
        <p className="text-xs text-muted-foreground">Best around {clockAt(last.ateAt, w.bestMin)}</p>
      </div>
      <ul className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
        {w.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
      {sheet}
    </Card>
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
            <input
              type="time"
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
