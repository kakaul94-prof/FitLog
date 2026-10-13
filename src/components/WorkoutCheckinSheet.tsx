import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Brain, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { PageHeader } from '@/components/layout/PageHeader'
import { TrainerChat } from '@/components/TrainerChat'
import { useRoutine, useStartFromRoutine } from '@/features/strength/useRoutines'
import { useCreateWorkout } from '@/features/strength/useStrength'
import { useRecoveryTarget, useSaveRecovery } from '@/features/strength/useRecovery'
import { useRehab } from '@/features/rehab/useRehab'
import { REGION_LABEL, type RegionId } from '@/data/bodyMap'
import { supabase } from '@/lib/supabase'
import { useSubmissionId } from '@/lib/idempotent'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'
import { cancelRecoveryCheck } from '@/lib/reminders'
import { PAIN_SITES, formatPain, isPaired, painMatchesInjury } from '@/lib/rehab'
import {
  flagsLabel,
  loadsFor,
  planSwaps,
  sitesWorked,
  type PlannedLift,
  type SwapAction,
} from '@/lib/checkin'
import { agoLabel, isRecent, musclesWorked, sorenessHeadsUp } from '@/lib/recovery'
import { isLiftKey } from '@/lib/warmup'
import type {
  BodySide,
  CheckinFlag,
  Injury,
  JointFeel,
  MuscleFeel,
  RecoveryAnswer,
  WorkoutCheckin,
} from '@/lib/database.types'

// The one check-in sheet. Before a workout: how the last one (< 3 days ago)
// landed — its main muscles and joints — plus the joints today loads. Achy or
// sharp joints drive today's swaps (lib/checkin.ts); very sore muscles only get
// a "go lighter" heads-up. The same rows open from the 9:00 notification with
// Save instead of Start. Swaps change today's workout only, never the routine.

export interface StartVars {
  /** Absent = a blank workout. */
  routineId?: string
  name: string
  date: string
  plan?: Record<string, number>
}

type StartExtra = {
  swaps?: Record<string, { key: string; name: string }>
  skip?: string[]
  checkin: WorkoutCheckin | null
}

/** Drop-in for starting a workout: `await start(vars)` opens the check-in and
 *  resolves to the new workout id, or null if it was closed. Render `sheet`. */
export function useWorkoutCheckin() {
  const startFrom = useStartFromRoutine()
  const create = useCreateWorkout()
  const createId = useSubmissionId()
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

  const begin = async (v: StartVars, extra: StartExtra): Promise<string> => {
    if (v.routineId)
      return startFrom.mutateAsync({ ...v, routineId: v.routineId, ...extra })
    const values = { workout_date: v.date, name: v.name }
    const w = await create.mutateAsync({ ...values, id: createId.idFor(values) })
    createId.clear()
    // Best-effort, like the routine path: no column yet = no record, still starts.
    if (extra.checkin)
      await supabase.from('workouts').update({ checkin: extra.checkin }).eq('id', w.id)
    return w.id
  }

  const sheet = vars ? (
    <CheckinSheet
      vars={vars}
      busy={startFrom.isPending || create.isPending}
      onCancel={() => finish(null)}
      onDone={async (extra) => finish(await begin(vars, extra))}
    />
  ) : null

  return { start, sheet, isPending: startFrom.isPending || create.isPending }
}

/** Morning mode, opened from the 9:00 notification (Lift tab `?recovery=<id>`). */
export function RecoverySheet({ workoutId, onClose }: { workoutId: string; onClose: () => void }) {
  return <CheckinSheet recoveryId={workoutId} busy={false} onCancel={onClose} onDone={async () => onClose()} />
}

type MuscleRow = { feel: MuscleFeel; side?: BodySide }
type JointRow = { feel: JointFeel; side?: BodySide }
type Choice = { action: SwapAction; toKey?: string }

const MUSCLE_OPTS: { value: MuscleFeel; label: string }[] = [
  { value: 'fine', label: 'Fine' },
  { value: 'sore', label: 'Sore' },
  { value: 'very_sore', label: 'Very sore' },
  { value: 'sharp', label: 'Sharp pain' },
]
const JOINT_OPTS: { value: JointFeel; label: string }[] = [
  { value: 'fine', label: 'Fine' },
  { value: 'achy', label: 'Achy' },
  { value: 'sharp', label: 'Sharp pain' },
]
const SIDE_OPTS: { value: Exclude<BodySide, null>; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
]
const TONE: Record<string, string> = {
  fine: 'border-foreground/40 bg-foreground/10 font-medium',
  sore: 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200',
  achy: 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200',
  very_sore: 'border-orange-500/70 bg-orange-500/20 text-orange-800 dark:text-orange-200',
  sharp: 'border-red-500/60 bg-red-500/15 text-red-800 dark:text-red-200',
  side: 'border-primary bg-primary/10 text-primary',
}

function Pills<T extends string>({
  value,
  options,
  onChange,
  tone,
}: {
  value: T | null | undefined
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  tone?: string
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
            value === o.value && TONE[tone ?? o.value],
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const cleanRow = <R extends { feel: string; side?: BodySide }>(r: R): R =>
  r.feel === 'sharp' ? r : ({ feel: r.feel } as R)

function CheckinSheet({
  vars,
  recoveryId,
  busy,
  onCancel,
  onDone,
}: {
  vars?: StartVars
  recoveryId?: string
  busy: boolean
  onCancel: () => void
  onDone: (extra: StartExtra) => Promise<void>
}) {
  const saveMode = !vars
  const today = todayISO()
  const { data: routineData, isLoading: routineLoading } = useRoutine(vars?.routineId)
  const { data: target, isLoading: targetLoading } = useRecoveryTarget(recoveryId)
  const saveRecovery = useSaveRecovery()
  const rehab = useRehab()
  const prev =
    target && (saveMode || isRecent(target.workout.workout_date, today)) ? target : null
  const prefill = prev?.workout.checkin?.after?.morning

  const [muscleOv, setMuscleOv] = useState<Record<string, MuscleRow>>({})
  const [jointOv, setJointOv] = useState<Record<string, JointRow>>({})
  const [rehabOn, setRehabOn] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [step, setStep] = useState<'check' | 'swaps'>('check')
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [askOpen, setAskOpen] = useState(false)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)

  const lifts: PlannedLift[] = useMemo(
    () =>
      vars?.routineId
        ? (routineData?.exercises ?? [])
            .filter(
              (re) =>
                isLiftKey(re.exercise_key) &&
                (!vars.plan || (vars.plan[re.id] ?? 0) > 0),
            )
            .map((re) => ({ id: re.id, key: re.exercise_key, name: re.exercise_name }))
        : [],
    [routineData, vars],
  )
  const loading = (!!vars?.routineId && routineLoading) || targetLoading

  const muscle = (r: string): MuscleRow => muscleOv[r] ?? prefill?.muscles[r] ?? { feel: 'fine' }
  const joint = (s: string): JointRow => jointOv[s] ?? prefill?.joints[s] ?? { feel: 'fine' }

  // Joints shown as rows: the last workout's plus the ones today loads. The
  // rest (and "other") sit behind "Something else hurts".
  const todayJoints = sitesWorked(lifts)
  const baseJoints = PAIN_SITES.filter(
    (s) => (prev?.joints ?? []).includes(s) || (!saveMode && todayJoints.includes(s)),
  )
  const extraJoints = PAIN_SITES.filter((s) => !baseJoints.includes(s))
  const showExtras =
    more || baseJoints.length === 0 || extraJoints.some((s) => joint(s).feel !== 'fine')
  const allJoints = showExtras ? [...baseJoints, ...extraJoints] : baseJoints

  const flagList: CheckinFlag[] = allJoints
    .map((site) => ({ site, row: joint(site) }))
    .filter(({ row }) => row.feel !== 'fine')
    .map(({ site, row }) => ({
      site,
      side: row.side ?? null,
      level: row.feel === 'sharp' ? 'sharp' : 'sore',
    }))
  const flagKey = JSON.stringify(flagList)
  const plan = useMemo(() => planSwaps(lifts, flagList), [lifts, flagKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const headsUp =
    prev && !saveMode
      ? sorenessHeadsUp(
          lifts,
          { muscles: Object.fromEntries(prev.muscles.map((r) => [r, muscle(r)])) },
          prev.customTag,
        )
      : []

  const choiceFor = (id: string): Choice => {
    const s = plan.suggestions.find((x) => x.lift.id === id)!
    const c = choices[id]
    if (!c) return { action: s.action, toKey: s.options[0]?.key }
    // Re-flagging can rule out an alternative picked earlier — fall back to
    // the best one still allowed rather than silently dropping the swap.
    const toKey = s.options.some((o) => o.key === c.toKey) ? c.toKey : s.options[0]?.key
    return { action: c.action === 'swap' && !toKey ? s.action : c.action, toKey }
  }

  // --- Rehab: a sharp row can open an injury dated to the workout. ----------
  const active = rehab.state.injuries.filter((i) => i.status === 'active')
  const inRehab = (kind: 'm' | 'j', id: string, side: BodySide) =>
    kind === 'j'
      ? active.some((i) => painMatchesInjury(formatPain(id, side), i))
      : active.some((i) => i.site === 'other' && i.note === REGION_LABEL[id as RegionId])
  const liftsHitting = (kind: 'm' | 'j', id: string) =>
    [...(prev?.lifts ?? []), ...lifts]
      .filter((l) =>
        kind === 'j'
          ? (loadsFor(l.key, l.name) ?? []).includes(id)
          : musclesWorked([l], prev?.customTag ?? new Map()).includes(id as RegionId),
      )
      .map((l) => l.key)
  const injuriesToAdd = (): Omit<Injury, 'id'>[] =>
    [...rehabOn].flatMap((k) => {
      const [kind, id] = k.split(':') as ['m' | 'j', string]
      const row = kind === 'm' ? muscle(id) : joint(id)
      if (row.feel !== 'sharp') return []
      const side = kind === 'j' && !isPaired(id) ? null : row.side ?? null
      if (inRehab(kind, id, side)) return []
      return [
        {
          site: kind === 'j' ? id : 'other',
          side,
          note: kind === 'm' ? REGION_LABEL[id as RegionId] : null,
          started: prev?.workout.workout_date ?? today,
          status: 'active' as const,
          resolved: null,
          aggravates: [...new Set(liftsHitting(kind, id))],
          plan: [],
        },
      ]
    })

  const buildAnswer = (): RecoveryAnswer => ({
    at: new Date().toISOString(),
    muscles: Object.fromEntries((prev?.muscles ?? []).map((r) => [r, cleanRow(muscle(r))])),
    joints: Object.fromEntries(
      allJoints
        .filter((s) => (prev?.joints ?? []).includes(s) || joint(s).feel !== 'fine')
        .map((s) => [s, cleanRow(joint(s))]),
    ),
  })

  const submit = async ({ record, withSwaps }: { record: boolean; withSwaps: boolean }) => {
    setError(false)
    setSaving(true)
    try {
      if (record) {
        if (prev)
          await saveRecovery(prev.workout, saveMode ? 'morning' : 'pre', buildAnswer()).catch(
            () => {},
          )
        if (rehab.ready) await rehab.addInjuries(injuriesToAdd()).catch(() => {})
      }
      void cancelRecoveryCheck()
      if (saveMode) return await onDone({ checkin: null })

      const swaps: Record<string, { key: string; name: string }> = {}
      const skip: string[] = []
      const rec: WorkoutCheckin = { flags: flagList, swaps: [], skipped: [] }
      if (withSwaps)
        for (const s of plan.suggestions) {
          const c = choiceFor(s.lift.id)
          const to = s.options.find((o) => o.key === c.toKey)
          if (c.action === 'skip') {
            skip.push(s.lift.id)
            rec.skipped.push(s.lift.name)
          } else if (c.action === 'swap' && to) {
            swaps[s.lift.id] = { key: to.key, name: to.name }
            rec.swaps.push({ fromKey: s.lift.key, fromName: s.lift.name, toKey: to.key, toName: to.name })
          }
        }
      await onDone({ swaps, skip, checkin: record && flagList.length ? rec : null })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const nChanges = plan.suggestions.filter((s) => choiceFor(s.lift.id).action !== 'keep').length
  const affected = new Set([
    ...plan.suggestions.map((s) => s.lift.id),
    ...plan.unknown.map((l) => l.id),
  ])
  const clear = lifts.filter((l) => !affected.has(l.id))
  const toReview = flagList.length > 0 && plan.suggestions.length + plan.unknown.length > 0
  const pending = busy || saving || loading
  const trainerDraft = `My ${flagsLabel(flagList)} today. What should I do instead of ${plan.unknown
    .map((l) => l.name)
    .join(', ')}?`

  const setRow = (
    kind: 'm' | 'j',
    id: string,
    patch: { feel?: MuscleFeel | JointFeel; side?: BodySide },
  ) =>
    kind === 'm'
      ? setMuscleOv((o) => ({ ...o, [id]: { ...muscle(id), ...patch } as MuscleRow }))
      : setJointOv((o) => ({ ...o, [id]: { ...joint(id), ...patch } as JointRow }))

  const renderRow = (kind: 'm' | 'j', id: string, label: string) => {
    const row = kind === 'm' ? muscle(id) : joint(id)
    const key = `${kind}:${id}`
    const sided = kind === 'm' || isPaired(id)
    const tracked = inRehab(kind, id, sided ? row.side ?? null : null)
    return (
      <div key={key} className="border-t py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <span className="text-sm capitalize">{label}</span>
          {kind === 'm' ? (
            <Pills value={row.feel as MuscleFeel} options={MUSCLE_OPTS} onChange={(feel) => setRow(kind, id, { feel })} />
          ) : (
            <Pills value={row.feel as JointFeel} options={JOINT_OPTS} onChange={(feel) => setRow(kind, id, { feel })} />
          )}
        </div>
        {row.feel === 'sharp' && (
          <div className="space-y-2 pt-2">
            {sided && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Side</span>
                <Pills
                  value={row.side ?? null}
                  options={SIDE_OPTS}
                  tone="side"
                  onChange={(side) => setRow(kind, id, { side: row.side === side ? null : side })}
                />
              </div>
            )}
            {tracked ? (
              <p className="text-xs text-muted-foreground">Already in the Rehab centre.</p>
            ) : (
              rehab.ready && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={rehabOn.has(key)}
                    onChange={(e) =>
                      setRehabOn((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(key)
                        else n.delete(key)
                        return n
                      })
                    }
                  />
                  Track in Rehab centre
                </label>
              )
            )}
          </div>
        )}
      </div>
    )
  }

  if (askOpen)
    return createPortal(
      <div className="fixed inset-0 z-50 mx-auto flex w-full max-w-md flex-col bg-background">
        <PageHeader
          title="Ask"
          subtitle={vars?.name}
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

  const weekday = prev
    ? new Date(`${prev.workout.workout_date}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
      })
    : ''

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={saveMode ? 'Recovery check-in' : 'Pre-workout check-in'}
        className="mx-auto w-full max-w-md p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="max-h-[85svh] space-y-3 overflow-y-auto p-4 text-foreground">
          {step === 'check' ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold leading-snug">
                    {prev
                      ? `How did ${prev.workout.name || 'your last workout'} land?`
                      : 'Before you lift'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {prev
                      ? `${weekday} · ${agoLabel(prev.workout.workout_date, today)}. ${
                          prefill && !saveMode ? 'Pre-filled from this morning.' : 'Everything starts as Fine.'
                        }`
                      : `${vars?.name ?? ''}${lifts.length ? ` · ${lifts.length} exercises` : ''}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Close">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {loading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {prev && prev.muscles.length > 0 && (
                    <div>
                      <p className="pb-1 text-xs text-muted-foreground">Muscles</p>
                      {prev.muscles.map((r) => renderRow('m', r, REGION_LABEL[r]))}
                    </div>
                  )}
                  {allJoints.length > 0 && (
                    <div>
                      <p className="pb-1 pt-1 text-xs text-muted-foreground">Joints</p>
                      {allJoints.map((s) => renderRow('j', s, s))}
                    </div>
                  )}
                  {!showExtras && (
                    <button className="text-sm font-medium text-primary" onClick={() => setMore(true)}>
                      + Something else hurts
                    </button>
                  )}
                  {headsUp.map((h) => (
                    <p
                      key={h.lift}
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
                    >
                      {h.lift} today works your {h.regions.join(' and ')} — go lighter.
                    </p>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Sharp pain that sticks around for more than a few days is worth a physio visit.
                  </p>
                </>
              )}

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">Couldn't save. Try again.</p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy || saving}
                  onClick={() => (saveMode ? onCancel() : submit({ record: false, withSwaps: false }))}
                >
                  Skip
                </Button>
                <Button
                  className="flex-[2]"
                  disabled={pending}
                  onClick={() =>
                    toReview ? setStep('swaps') : submit({ record: true, withSwaps: false })
                  }
                >
                  {busy || saving
                    ? saveMode
                      ? 'Saving…'
                      : 'Starting…'
                    : saveMode
                      ? 'Save'
                      : toReview
                        ? `Review ${plan.suggestions.length || ''} swap${plan.suggestions.length === 1 ? '' : 's'}`
                        : 'Start workout'}
                </Button>
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
                                  o.key === c.toKey && TONE.side,
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
                  <p className="text-xs text-muted-foreground">
                    No swap rule for {plan.unknown.length === 1 ? 'this one' : 'these'}.
                  </p>
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

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">Couldn't start. Try again.</p>
              )}
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => submit({ record: true, withSwaps: true })}
              >
                {busy || saving
                  ? 'Starting…'
                  : nChanges
                    ? `Start with ${nChanges} change${nChanges === 1 ? '' : 's'}`
                    : 'Start workout'}
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>,
    document.body,
  )
}
