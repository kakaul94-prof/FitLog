import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Brain, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { PageHeader } from '@/components/layout/PageHeader'
import { TrainerChat } from '@/components/TrainerChat'
import { useRoutine, useStartFromRoutine } from '@/features/strength/useRoutines'
import { useRehab } from '@/features/rehab/useRehab'
import { isCardioKey } from '@/lib/cardio'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'
import {
  PAIN_SITES,
  formatPain,
  injuryDay,
  injuryLabel,
  isPaired,
  painMatchesInjury,
} from '@/lib/rehab'
import {
  flagsLabel,
  planSwaps,
  sitesWorked,
  type PlannedLift,
  type SwapAction,
} from '@/lib/checkin'
import type {
  BodySide,
  CheckinFlag,
  PainLevel,
  WorkoutCheckin,
} from '@/lib/database.types'

// Pre-workout check-in. Every start-from-routine goes through here: one tap on
// "All good" when nothing hurts; otherwise flag sore/sharp spots and review the
// swaps lib/checkin.ts suggests. Swaps change today's workout only — the
// routine itself is never touched.

export interface StartVars {
  routineId: string
  name: string
  date: string
  plan?: Record<string, number>
}

/** Drop-in for useStartFromRoutine: `await start(vars)` opens the check-in and
 *  resolves to the new workout id, or null if it was closed. Render `sheet`. */
export function useWorkoutCheckin() {
  const startFrom = useStartFromRoutine()
  const [vars, setVars] = useState<StartVars | null>(null)
  const resolver = useRef<((id: string | null) => void) | null>(null)

  const finish = (id: string | null) => {
    resolver.current?.(id)
    resolver.current = null
    setVars(null)
  }

  const start = (v: StartVars) =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve
      setVars(v)
    })

  const sheet = vars ? (
    <WorkoutCheckinSheet
      vars={vars}
      busy={startFrom.isPending}
      onCancel={() => finish(null)}
      onStart={async (extra) => finish(await startFrom.mutateAsync({ ...vars, ...extra }))}
    />
  ) : null

  return { start, sheet, isPending: startFrom.isPending }
}

type Flags = Record<string, { level: PainLevel; side: BodySide }>
type Choice = { action: SwapAction; toKey?: string }

const NEXT_LEVEL: Record<string, PainLevel | null> = {
  none: 'sore',
  sore: 'sharp',
  sharp: null,
}

function WorkoutCheckinSheet({
  vars,
  busy,
  onCancel,
  onStart,
}: {
  vars: StartVars
  busy: boolean
  onCancel: () => void
  onStart: (extra: {
    swaps?: Record<string, { key: string; name: string }>
    skip?: string[]
    checkin: WorkoutCheckin | null
  }) => Promise<void>
}) {
  const { data } = useRoutine(vars.routineId)
  const rehab = useRehab()
  const today = todayISO()
  const [flags, setFlags] = useState<Flags>({})
  const [step, setStep] = useState<'check' | 'swaps'>('check')
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [askOpen, setAskOpen] = useState(false)
  const [tracked, setTracked] = useState<string[]>([])
  const [error, setError] = useState(false)

  const lifts: PlannedLift[] = useMemo(
    () =>
      (data?.exercises ?? [])
        .filter(
          (re) =>
            !isCardioKey(re.exercise_key) &&
            (!vars.plan || (vars.plan[re.id] ?? 0) > 0),
        )
        .map((re) => ({ id: re.id, key: re.exercise_key, name: re.exercise_name })),
    [data, vars.plan],
  )

  const flagList: CheckinFlag[] = Object.entries(flags).map(([site, f]) => ({
    site,
    ...f,
  }))
  const plan = useMemo(() => planSwaps(lifts, flagList), [lifts, flags]) // eslint-disable-line react-hooks/exhaustive-deps
  const worked = useMemo(() => sitesWorked(lifts), [lifts])
  const openInjuries = rehab.state.injuries.filter(
    (i) => i.status === 'active' && !flags[i.site],
  )
  const choiceFor = (id: string): Choice => {
    const s = plan.suggestions.find((x) => x.lift.id === id)!
    const c = choices[id]
    if (!c) return { action: s.action, toKey: s.options[0]?.key }
    // Re-flagging can rule out an alternative picked earlier — fall back to
    // the best one still allowed rather than silently dropping the swap.
    const toKey = s.options.some((o) => o.key === c.toKey) ? c.toKey : s.options[0]?.key
    return { action: c.action === 'swap' && !toKey ? s.action : c.action, toKey }
  }

  const cycle = (site: string) =>
    setFlags((f) => {
      const next = NEXT_LEVEL[f[site]?.level ?? 'none']
      const { [site]: _, ...rest } = f // eslint-disable-line @typescript-eslint/no-unused-vars
      return next ? { ...f, [site]: { level: next, side: f[site]?.side ?? null } } : rest
    })
  const setSide = (site: string, side: BodySide) =>
    setFlags((f) => ({ ...f, [site]: { ...f[site], side: f[site].side === side ? null : side } }))

  const go = async (withSwaps: boolean) => {
    setError(false)
    const swaps: Record<string, { key: string; name: string }> = {}
    const skip: string[] = []
    const record: WorkoutCheckin = { flags: flagList, swaps: [], skipped: [] }
    if (withSwaps) {
      for (const s of plan.suggestions) {
        const c = choiceFor(s.lift.id)
        const to = s.options.find((o) => o.key === c.toKey)
        if (c.action === 'skip') {
          skip.push(s.lift.id)
          record.skipped.push(s.lift.name)
        } else if (c.action === 'swap' && to) {
          swaps[s.lift.id] = { key: to.key, name: to.name }
          record.swaps.push({
            fromKey: s.lift.key,
            fromName: s.lift.name,
            toKey: to.key,
            toName: to.name,
          })
        }
      }
    }
    try {
      await onStart({ swaps, skip, checkin: flagList.length ? record : null })
    } catch {
      setError(true)
    }
  }

  // Sharp spots with no open injury get a one-tap "track it in Rehab"; the
  // planned lifts that load it become the injury's aggravating list, which is
  // what drives the existing in-workout warning.
  const sharpUntracked = flagList.filter(
    (f) =>
      rehab.ready &&
      f.level === 'sharp' &&
      f.site !== 'other' &&
      !tracked.includes(f.site) &&
      !rehab.state.injuries.some(
        (i) => i.status === 'active' && painMatchesInjury(formatPain(f.site, f.side), i),
      ),
  )
  const track = async (f: CheckinFlag) => {
    if (!rehab.ready) return
    await rehab.addInjury({
      site: f.site,
      side: f.side,
      started: today,
      status: 'active',
      resolved: null,
      aggravates: plan.suggestions
        .filter((s) => s.hits.includes(f.site))
        .map((s) => s.lift.key),
      plan: [],
    })
    setTracked((t) => [...t, f.site])
  }
  const trackSafe = (f: CheckinFlag) => track(f).catch(() => {})

  const nChanges = plan.suggestions.filter((s) => choiceFor(s.lift.id).action !== 'keep').length
  const affected = new Set([
    ...plan.suggestions.map((s) => s.lift.id),
    ...plan.unknown.map((l) => l.id),
  ])
  const clear = lifts.filter((l) => !affected.has(l.id))
  const trainerDraft = `My ${flagsLabel(flagList)} today. What should I do instead of ${plan.unknown
    .map((l) => l.name)
    .join(', ')}?`

  if (askOpen)
    return createPortal(
      <div className="fixed inset-0 z-50 mx-auto flex w-full max-w-md flex-col bg-background">
        <PageHeader
          title="Ask"
          subtitle={vars.name}
          left={
            <Button variant="ghost" size="icon" onClick={() => setAskOpen(false)} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          }
        />
        <TrainerChat initialDraft={trainerDraft} />
      </div>,
      document.body,
    )

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onCancel}>
      <div
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="max-h-[85svh] space-y-4 overflow-y-auto p-4 text-foreground">
          {step === 'check' ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">Before you lift</p>
                  <p className="text-sm text-muted-foreground">
                    {vars.name} · {lifts.length} exercise{lifts.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {worked.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Today works</p>
                  <div className="flex flex-wrap gap-1.5">
                    {worked.map((s) => (
                      <span key={s} className="rounded-full border px-2.5 py-0.5 text-xs capitalize">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Anything hurting? Tap once for sore, twice for sharp
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PAIN_SITES.map((site) => {
                    const lvl = flags[site]?.level
                    return (
                      <button
                        key={site}
                        onClick={() => cycle(site)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-sm capitalize transition-colors',
                          lvl === 'sore' && 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300',
                          lvl === 'sharp' && 'border-red-500/60 bg-red-500/15 text-red-700 dark:text-red-300',
                        )}
                      >
                        {site}
                        {lvl && ` · ${lvl}`}
                      </button>
                    )
                  })}
                </div>
                {flagList
                  .filter((f) => isPaired(f.site))
                  .map((f) => (
                    <div key={f.site} className="flex items-center gap-1.5 pt-1 text-sm">
                      <span className="w-20 capitalize text-muted-foreground">{f.site}</span>
                      {(['left', 'right', 'both'] as const).map((side) => (
                        <button
                          key={side}
                          onClick={() => setSide(f.site, side)}
                          className={cn(
                            'rounded-md border px-2.5 py-0.5 text-xs capitalize',
                            f.side === side && 'border-primary bg-primary/10 text-primary',
                          )}
                        >
                          {side}
                        </button>
                      ))}
                    </div>
                  ))}
              </div>

              {openInjuries.map((inj) => (
                <button
                  key={inj.id}
                  onClick={() =>
                    setFlags((f) => ({ ...f, [inj.site]: { level: 'sore', side: inj.side } }))
                  }
                  className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-800 dark:text-amber-200"
                >
                  Open injury: {injuryLabel(inj).toLowerCase()} (day {injuryDay(inj, today)}).
                  Still bothering you? <span className="font-medium underline">Mark sore</span>
                </button>
              ))}

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">Couldn't start. Try again.</p>
              )}
              <div className="space-y-2">
                {flagList.length === 0 ? (
                  <Button className="w-full" disabled={busy || !data} onClick={() => go(false)}>
                    {busy ? 'Starting…' : 'All good, start'}
                  </Button>
                ) : plan.suggestions.length + plan.unknown.length > 0 ? (
                  <>
                    <Button className="w-full" onClick={() => setStep('swaps')}>
                      Review {plan.suggestions.length || ''} swap
                      {plan.suggestions.length === 1 ? '' : 's'}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={busy}
                      onClick={() => go(false)}
                    >
                      Start as planned
                    </Button>
                  </>
                ) : (
                  <Button className="w-full" disabled={busy || !data} onClick={() => go(false)}>
                    {busy ? 'Starting…' : 'Start — nothing today loads it'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => setStep('check')} aria-label="Back">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <p className="font-semibold">Suggested swaps</p>
                  <p className="text-sm text-muted-foreground">Easier on: {flagsLabel(flagList)}</p>
                </div>
              </div>

              {plan.suggestions.map((s) => {
                const c = choiceFor(s.lift.id)
                const set = (patch: Partial<Choice>) =>
                  setChoices((cs) => ({ ...cs, [s.lift.id]: { ...c, ...patch } }))
                const to = s.options.find((o) => o.key === c.toKey)
                return (
                  <div key={s.lift.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'font-medium',
                          c.action !== 'keep' && 'text-muted-foreground line-through',
                        )}
                      >
                        {s.lift.name}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs',
                          s.level === 'sharp' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                        )}
                      >
                        loads {s.hits.join(', ')}
                      </span>
                    </div>
                    <Segmented<SwapAction>
                      value={c.action}
                      onChange={(action) => set({ action })}
                      options={[
                        ...(s.options.length ? [{ value: 'swap' as const, label: 'Swap' }] : []),
                        { value: 'skip', label: 'Skip' },
                        { value: 'keep', label: 'Keep' },
                      ]}
                    />
                    {c.action === 'swap' && to && (
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-1.5 text-sm">
                          <ArrowRight className="h-4 w-4 text-primary" />
                          <span className="font-medium">{to.name}</span>
                          <span className="text-muted-foreground">· {to.equipment}</span>
                        </p>
                        {s.options.length > 1 && (
                          <div className="flex flex-wrap gap-1.5">
                            {s.options.map((o) => (
                              <button
                                key={o.key}
                                onClick={() => set({ toKey: o.key })}
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-xs',
                                  o.key === c.toKey && 'border-primary bg-primary/10 text-primary',
                                )}
                              >
                                {o.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {c.action === 'keep' && !s.options.length && (
                      <p className="text-xs text-muted-foreground">
                        No easier option in the table — go lighter, or skip it.
                      </p>
                    )}
                  </div>
                )
              })}

              {plan.unknown.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm">{plan.unknown.map((l) => l.name).join(', ')}</p>
                  <p className="text-xs text-muted-foreground">No swap rule for {plan.unknown.length === 1 ? 'this one' : 'these'}.</p>
                  <Button variant="outline" size="sm" onClick={() => setAskOpen(true)}>
                    <Brain className="mr-1.5 h-4 w-4" /> Ask trainer
                  </Button>
                </div>
              )}

              {clear.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {clear.map((l) => l.name).join(', ')} unaffected
                </p>
              )}

              {sharpUntracked.map((f) => (
                <div
                  key={f.site}
                  className="flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200"
                >
                  <span>Sharp {formatPain(f.site, f.side)} — keep an eye on it?</span>
                  <Button size="sm" variant="outline" disabled={rehab.isSaving} onClick={() => trackSafe(f)}>
                    Track in Rehab
                  </Button>
                </div>
              ))}
              {tracked.length > 0 && (
                <p className="text-xs text-muted-foreground">Added to Rehab.</p>
              )}

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">Couldn't start. Try again.</p>
              )}
              <Button className="w-full" disabled={busy || !data} onClick={() => go(true)}>
                {busy
                  ? 'Starting…'
                  : nChanges
                    ? `Start with ${nChanges} change${nChanges === 1 ? '' : 's'}`
                    : 'Start'}
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>,
    document.body,
  )
}
