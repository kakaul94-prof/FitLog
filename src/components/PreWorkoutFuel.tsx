import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, CupSoda, Moon, UtensilsCrossed, X, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { TimeInput } from '@/components/ui/time-input'
import { cn } from '@/lib/utils'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useDiary } from '@/features/diary/useDiary'
import { timeLabel, todayISO } from '@/lib/date'
import {
  drinkPlan,
  formatMinutes,
  gapMinutes,
  gentleDrinkMin,
  lateCaffeine,
  pendingFuelMeal,
  preWorkoutWindow,
  recordDrinkFeedback,
  recordFuelFeedback,
  rememberFuelMeal,
  type DrinkPlan,
  type FuelWindow,
} from '@/lib/fuel'
import type { DiaryEntry, DrinkHit, FuelDrink, FuelFeel, FuelTimingState, Meal } from '@/lib/database.types'

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

const HITS: { key: DrinkHit; label: string }[] = [
  { key: 'not-yet', label: 'Not yet' },
  { key: 'right', label: 'Right on' },
  { key: 'fading', label: 'Already fading' },
]

const DEFAULT_CAFFEINE_MG = 200
const num = (s: string) => Math.max(0, Math.round(Number(s) || 0))

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

// drinkPlan options: a drink you took is timed from when you drank it; a
// planned one is never put in the past.
const drinkOpts = (ateAt: string, drankAt: string | null, offsetMin: number) =>
  drankAt
    ? { drankMin: gapMinutes(ateAt, drankAt), offsetMin }
    : { notBeforeMin: gapMinutes(ateAt, new Date().toISOString()), offsetMin }

// Lift tab tile: pick today's pre-workout meal from the diary and get a comfort
// window to train in (lib/fuel.ts). Reads "Fuel" until a meal is timed. With a
// pre-workout drink it adds when to drink, or, once you've had it, when to
// start (where the meal window and the drink's kick overlap).
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
  const drink = last?.drink ?? null
  const plan =
    last && w && drink
      ? drinkPlan(w, drink, drinkOpts(last.ateAt, drink.at, state?.drinkOffsetMin ?? 0))
      : null

  let timed: { label: string; aria: string } | null = null
  if (last && w) {
    const at = (m: number) => shortClockAt(last.ateAt, m)
    const say = (m: number) => clockAt(last.ateAt, m)
    if (plan && drink?.at) {
      const [lo, hi] = plan.startMin ?? [plan.kickStartMin, plan.kickEndMin]
      timed = { label: `Start ${at(lo)}–${at(hi)}`, aria: `Pre-workout fuel: start ${say(lo)} to ${say(hi)}` }
    } else {
      const meal = `${at(w.earliestMin)}–${at(w.latestMin)}`
      const aria = `Pre-workout fuel: train ${say(w.earliestMin)} to ${say(w.latestMin)}`
      timed = plan
        ? { label: `${meal} · drink ${at(plan.drinkMin)}`, aria: `${aria}, drink at ${say(plan.drinkMin)}` }
        : { label: meal, aria }
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={profile === undefined}
        aria-label={timed?.aria ?? 'Time your pre-workout meal'}
        className={cn(className, timed && 'bg-primary/15 font-medium text-primary active:bg-primary/25')}
      >
        <span className="flex gap-1">
          <UtensilsCrossed className={cn('h-5 w-5', timed ? 'text-primary' : 'text-foreground')} />
          {plan && <CupSoda className="h-5 w-5 text-primary" />}
        </span>
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

  // Pre-workout drink: today's if this meal already has one, else your usual.
  const prefs = state?.drink
  const [drinkOn, setDrinkOn] = useState(initial ? !!initial.drink : (prefs?.on ?? false))
  const [caffeine, setCaffeine] = useState(String(initial?.drink?.caffeineMg ?? prefs?.caffeineMg ?? DEFAULT_CAFFEINE_MG))
  const [carbs, setCarbs] = useState(String(initial?.drink?.carbG ?? prefs?.carbG ?? 0))
  const [drank, setDrank] = useState(!!initial?.drink?.at)
  const [drankTime, setDrankTime] = useState<string | null>(initial?.drink?.at ? hhmm(initial.drink.at) : null)
  const drankShown = drankTime ?? hhmm(nowISO)
  const drankAtMs = new Date(`${today}T${drankShown}`).getTime()
  const drankFuture = drinkOn && drank && drankAtMs > Date.now()
  const drinkIn = { caffeineMg: num(caffeine), carbG: num(carbs) }
  const drankISO = drank ? new Date(drankAtMs).toISOString() : null
  const dPlan =
    preview && drinkOn && !drankFuture
      ? drinkPlan(preview, drinkIn, drinkOpts(ateISO, drankISO, state?.drinkOffsetMin ?? 0))
      : null

  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const save = () => {
    if (!preview || future || drankFuture) return
    const drink: FuelDrink | null = dPlan ? { at: drankISO, ...drinkIn, leadMin: dPlan.leadMin } : null
    update.mutate(
      { fuel_timing: rememberFuelMeal(state, ateISO, ids, preview, { on: drinkOn, ...drinkIn }, drink) },
      { onSuccess: onClose },
    )
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
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <CupSoda className="h-4 w-4 text-primary" /> Pre-workout drink
              </span>
              <Switch checked={drinkOn} onClick={() => setDrinkOn((v) => !v)} label="Pre-workout drink" />
            </div>
            {drinkOn && (
              <>
                <div className="flex gap-3 text-sm">
                  <label className="flex flex-1 items-center justify-between gap-2">
                    <span className="text-muted-foreground">Caffeine</span>
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={caffeine}
                        onChange={(ev) => setCaffeine(ev.target.value)}
                        className="h-8 w-16 text-right"
                      />
                      mg
                    </span>
                  </label>
                  <label className="flex flex-1 items-center justify-between gap-2">
                    <span className="text-muted-foreground">Carbs</span>
                    <span className="flex items-center gap-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={carbs}
                        onChange={(ev) => setCarbs(ev.target.value)}
                        className="h-8 w-14 text-right"
                      />
                      g
                    </span>
                  </label>
                </div>
                <Segmented
                  value={drank ? 'drank' : 'plan'}
                  onChange={(v) => setDrank(v === 'drank')}
                  options={[
                    { value: 'plan', label: 'Plan it for me' },
                    { value: 'drank', label: 'Already drank it' },
                  ]}
                />
                {drank && (
                  <label className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Drank at</span>
                    <TimeInput
                      value={drankShown}
                      onChange={(ev) => setDrankTime(ev.target.value || null)}
                      className={cn(
                        'rounded-md border bg-background px-2 py-1',
                        drankFuture ? 'border-destructive' : 'border-border',
                      )}
                    />
                  </label>
                )}
                {drankFuture ? (
                  <p className="text-xs text-destructive">That's later than now. Set when you actually drank it.</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Remembered for next time. Carbs count as fast fuel.</p>
                )}
              </>
            )}
          </div>
          {preview && <FuelPreview w={preview} ateISO={ateISO} plan={dPlan} drankISO={drankISO} caffeineMg={drinkIn.caffeineMg} />}
          {update.isError && <p className="text-xs text-destructive">Couldn't save. Try again.</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={save} disabled={total <= 0 || future || drankFuture || update.isPending}>
              {update.isPending ? 'Saving…' : `Time my workout · ${total} kcal`}
            </Button>
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}

function Warn({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex gap-1.5 rounded-md bg-warning/15 p-2 text-xs text-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  )
}

// The sheet's live preview: the meal window (or, once you've had the drink,
// where it overlaps the kick), the drink's timing, and any warnings.
function FuelPreview({
  w,
  ateISO,
  plan,
  drankISO,
  caffeineMg,
}: {
  w: FuelWindow
  ateISO: string
  plan: DrinkPlan | null
  drankISO: string | null
  caffeineMg: number
}) {
  const at = (m: number) => clockAt(ateISO, m)
  const drinkAt = plan ? new Date(new Date(ateISO).getTime() + plan.drinkMin * 60_000) : null
  const late = drinkAt ? lateCaffeine(drinkAt, caffeineMg) : null
  const took = plan && drankISO ? plan : null
  const startSpan = took ? (took.startMin ?? [took.kickStartMin, took.kickEndMin]) : null

  return (
    <div className="space-y-2 rounded-lg bg-primary/10 p-2.5">
      <div>
        {took && startSpan ? (
          <>
            <p className="text-sm font-semibold text-primary">
              Start {at(startSpan[0])} – {at(startSpan[1])}
            </p>
            <p className="text-xs text-muted-foreground">
              {took.miss === 'early'
                ? 'The kick lands before your meal settles, so expect it to feel heavy'
                : took.miss === 'late'
                  ? 'The kick lands after the meal window, so you may feel flat. Carbs in the drink would help.'
                  : "Where the meal window and the drink's kick overlap"}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-primary">
              Train {at(w.earliestMin)} – {at(w.latestMin)}
            </p>
            <p className="text-xs text-muted-foreground">Best around {at(w.bestMin)}</p>
          </>
        )}
      </div>
      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        {w.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
      {plan && drinkAt && (
        <div className="space-y-0.5 border-t border-primary/20 pt-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CupSoda className="h-4 w-4 shrink-0 text-primary" />
            {took
              ? `Drank ${timeLabel(drankISO!)} · kick ~${at(took.kickStartMin)} – ${at(took.kickEndMin)}`
              : drinkAt.getTime() - Date.now() < 5 * 60_000
                ? 'Drink now'
                : `Drink at ${at(plan.drinkMin)}`}
          </p>
          {!took && (
            <p className="text-xs text-muted-foreground">
              Kicks in ~{at(plan.kickStartMin)}. Start then.
              {plan.miss === 'late' && " That's past the meal window, so you may feel flat."}
            </p>
          )}
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {plan.reasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}
      {took?.fullStomach && (
        <Warn icon={AlertTriangle}>
          Your meal was still about {Math.round(took.stomachShare * 100)}% in your stomach. A pre-workout on a full
          stomach is a common nausea trigger. Next time try {at(gentleDrinkMin(w))} or later, or a half scoop.
        </Warn>
      )}
      {late && (
        <Warn icon={Moon}>
          About half the caffeine is still in you around {timeLabel(late.toISOString())}, which can cost sleep.
        </Warn>
      )}
    </div>
  )
}

function Pills<T extends string>({
  options,
  onPick,
  disabled,
}: {
  options: { key: T; label: string }[]
  onPick: (k: T) => void
  disabled: boolean
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.key)}
          className={cn(pill, 'flex-1 py-1.5 text-center disabled:opacity-50')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Workout page: once per timed meal, ask how the stomach felt and, if you
// logged drinking a pre-workout, how it hit. Answers that contradict the
// timing shift future meal windows ±15 min and the drink lead ±10 min.
export function FuelFeedbackPrompt({ startedAt }: { startedAt: string }) {
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const state = profile?.fuel_timing ?? null
  const last = pendingFuelMeal(state, startedAt)
  if (!state || !last) return null
  const gap = gapMinutes(last.ateAt, startedAt)
  const askMeal = !last.mealRated
  const drink = last.drink?.at && !last.drink.rated ? last.drink : null
  const drinkGap = drink?.at ? gapMinutes(drink.at, startedAt) : -1
  // Drank after starting: nothing to ask about it.
  const askDrink = drinkGap >= 0
  if (!askMeal && !askDrink) return null

  const answerMeal = (feel: FuelFeel) =>
    update.mutate({ fuel_timing: recordFuelFeedback(state, feel, gap, todayISO()) })
  const answerDrink = (hit: DrinkHit) => update.mutate({ fuel_timing: recordDrinkFeedback(state, hit, drinkGap) })
  const skip = () => update.mutate({ fuel_timing: { ...state, last: null } })

  const drinkTitle = 'How did the pre-workout hit?'
  const drinkSub = `Drank ${formatMinutes(drinkGap)} before you started`
  return (
    <Card className="space-y-2 border-primary/40 p-3 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{askMeal ? "How's your stomach?" : drinkTitle}</p>
          <p className="text-xs text-muted-foreground">
            {askMeal ? `${last.kcal} kcal eaten ${formatMinutes(gap)} before you started` : drinkSub}
          </p>
        </div>
        <button type="button" onClick={skip} aria-label="Skip" className="text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {askMeal && <Pills options={FEELS} onPick={answerMeal} disabled={update.isPending} />}
      {askDrink &&
        (askMeal ? (
          <div className="space-y-1.5 border-t border-border pt-2">
            <div>
              <p className="font-semibold">{drinkTitle}</p>
              <p className="text-xs text-muted-foreground">{drinkSub}</p>
            </div>
            <Pills options={HITS} onPick={answerDrink} disabled={update.isPending} />
          </div>
        ) : (
          <Pills options={HITS} onPick={answerDrink} disabled={update.isPending} />
        ))}
      <p className="text-[11px] text-muted-foreground">
        {askMeal && askDrink
          ? 'Shifts your future meal window ±15 min and drink timing ±10 min'
          : askMeal
            ? 'Shifts your future windows by ±15 min'
            : 'Shifts your future drink timing by ±10 min'}
      </p>
    </Card>
  )
}
