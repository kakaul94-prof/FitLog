import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Flame,
  MapPin,
  Plus,
  X,
  Link2,
  Check,
  Play,
  LogOut,
  Trash2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  useWorkout,
  useAddSet,
  useUpdateSet,
  useDeleteSet,
  useUpdateExercise,
  useUpdateSupersetTiming,
  useDeleteExercise,
  useLastExerciseNote,
  useUpdateWorkout,
  useRestoreWorkout,
  useDeleteWorkout,
  useExerciseBests,
  type WorkoutSnapshot,
} from '@/features/strength/useStrength'
import { useRegisterRestTimer } from '@/components/strength/RestTimerProvider'
import { useStrengthGoalMap } from '@/features/strength/useStrengthGoals'
import { useRoutine } from '@/features/strength/useRoutines'
import { useExerciseEntries } from '@/features/exercise/useExercise'
import { useCustomActivities } from '@/features/exercise/useCustomActivities'
import {
  cardioActivityKey,
  cardioTargetChips,
  entryMatchesCardio,
  findCardioActivity,
  isCardioKey,
  isRecorderActivity,
} from '@/lib/cardio'
import { zoneColor } from '@/data/zones'
import { estimated1RM, warmupRamp } from '@/lib/calc'
import { suggestNextSet, type NextSetSuggestion } from '@/lib/progression'
import { EXERCISES, isHoldKind } from '@/data/exercises'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import { dateLabel, timeLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type {
  RoutineExercise,
  WorkoutExercise,
  WorkoutSet,
} from '@/lib/database.types'

// A personal-record hit, surfaced as a celebration banner. `value` is the new
// best, `prev` the old one it beat. `weight` (heaviest set) and `volume`
// (biggest single set's reps × weight, with `detail` = "weight × reps") fire
// per SET as it's logged; `session` (biggest total tonnage) fires on Done.
type PRHit = {
  id: number
  metric: 'weight' | 'volume' | 'session'
  name: string
  value: number
  prev: number
  detail?: string
}

// Stable signature of the workout's logged content (exercises + sets), used to
// tell whether anything was actually edited while viewing. Ordering is stable
// (exercises by position, sets by set_number), so plain array order is fine.
const serializeWorkout = (ex: WorkoutExercise[], st: WorkoutSet[]) =>
  JSON.stringify({
    ex: ex.map((e) => ({
      id: e.id,
      position: e.position,
      notes: e.notes,
      superset_group: e.superset_group,
      started_at: e.started_at,
      ended_at: e.ended_at,
    })),
    st: st.map((s) => ({
      id: s.id,
      we: s.workout_exercise_id,
      set_number: s.set_number,
      reps: s.reps,
      weight_lb: s.weight_lb,
      duration_sec: s.duration_sec,
      distance: s.distance,
      effort: s.effort,
      is_warmup: s.is_warmup,
    })),
  })

// Whether a set carries any logged value — weight / reps, or a cardio-style
// duration / distance. Empty set boxes read as null.
const setHasData = (s: WorkoutSet) =>
  s.reps != null ||
  s.weight_lb != null ||
  s.duration_sec != null ||
  s.distance != null

// True when a workout has anything worth keeping this session: a set with data,
// or a typed exercise note. An untouched empty/template workout has neither.
const hasLoggedContent = (ex: WorkoutExercise[], st: WorkoutSet[]) =>
  st.some(setHasData) || ex.some((e) => (e.notes ?? '').trim() !== '')

export function WorkoutPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [showCompleted, setShowCompleted] = useState(false)
  const updateWorkout = useUpdateWorkout()
  const { data } = useWorkout(id)
  const workout = data?.workout
  const exercises = data?.exercises ?? []
  const sets = data?.sets ?? []

  // Cardio items programmed on the source template. They never become workout
  // exercises — they render as a checklist here, and logging one writes a
  // normal cardio entry (calories/eat-back/trends all unchanged).
  const { data: routineData } = useRoutine(
    workout?.source_routine_id ?? undefined,
  )
  const cardioItems = (routineData?.exercises ?? []).filter((e) =>
    isCardioKey(e.exercise_key),
  )
  // The template's rep targets, for the next-set coach on lifts with no
  // strength goal to take a rep range from.
  const routineTargets = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of routineData?.exercises ?? [])
      if (!isCardioKey(e.exercise_key) && e.target_reps != null)
        m.set(e.exercise_key, e.target_reps)
    return m
  }, [routineData])

  // PR celebration queue: exercise cards report hits up here; we show one banner
  // at a time and auto-dismiss it after a few seconds (tap dismisses early).
  const [prs, setPrs] = useState<PRHit[]>([])
  const prIdRef = useRef(0)
  const onPR = useCallback((hit: Omit<PRHit, 'id'>) => {
    setPrs((q) => [...q, { ...hit, id: ++prIdRef.current }])
  }, [])
  const currentPR = prs[0]
  // Each banner gets its own ~3.5s; queueing more behind it doesn't reset the
  // visible one's timer (keyed on the front banner's id, not the whole queue).
  useEffect(() => {
    if (!currentPR) return
    const t = setTimeout(() => setPrs((q) => q.slice(1)), 3500)
    return () => clearTimeout(t)
  }, [currentPR?.id])

  // Register this workout's rest duration with the global timer so the running
  // countdown persists across navigation (the bar is rendered at the app root).
  const workoutId = workout?.id
  const mutate = updateWorkout.mutate
  const onChangeRest = useCallback(
    (sec: number) => {
      if (workoutId) mutate({ id: workoutId, rest_seconds: sec })
    },
    [workoutId, mutate],
  )
  useRegisterRestTimer(
    workout ? (workout.rest_seconds ?? 90) : undefined,
    onChangeRest,
  )

  // Snapshot the workout's content on first load: the signature tells whether
  // anything was edited this visit (an untouched workout skips the exit prompt),
  // and the full snapshot lets "Discard changes" revert this session's edits.
  const loadedRef = useRef(false)
  // Was the workout blank the moment it opened? Gates the auto-discard so we
  // never silently delete a previously-saved workout that gets cleared out.
  const openedBlankRef = useRef(false)
  const [original, setOriginal] = useState<string | null>(null)
  const snapshotRef = useRef<WorkoutSnapshot | null>(null)
  const signature = useMemo(() => serializeWorkout(exercises, sets), [exercises, sets])
  useEffect(() => {
    if (loadedRef.current || !data?.workout) return
    loadedRef.current = true
    setOriginal(signature)
    openedBlankRef.current = !hasLoggedContent(data.exercises, data.sets)
    snapshotRef.current = {
      exercises: data.exercises,
      sets: data.sets,
      rest_seconds: data.workout.rest_seconds,
    }
  }, [data, signature])
  const dirty = original != null && signature !== original
  // "Blank" = an in-progress workout with nothing logged this session. When it
  // also opened blank, leaving discards it instead of saving an empty workout —
  // covers an empty start, a blank added exercise, or a template whose sets were
  // never filled in.
  const isBlank =
    !!workout && !workout.completed && !hasLoggedContent(exercises, sets)
  const discardBlank = isBlank && openedBlankRef.current

  // Pressing back (arrow or Android system gesture) on a changed, in-progress
  // workout asks how to leave: "Save & exit" keeps the live-saved edits (resume
  // later); "Discard changes" reverts this session's edits. The workout itself
  // is never deleted here — that's long-press on the list. The prompt is skipped
  // when the workout is done or nothing changed this visit. Navigations deeper
  // in (add exercise, an exercise's stats) pass through; leavingRef lets Done /
  // Save / Discard exit cleanly.
  const restore = useRestoreWorkout()
  const del = useDeleteWorkout()
  const leavingRef = useRef(false)
  const blocker = useBlocker(({ nextLocation }) => {
    if (leavingRef.current || workout?.completed) return false
    const p = nextLocation.pathname
    const internal =
      p.startsWith(`/workout/${id}`) || p.startsWith('/lift/exercise/')
    if (internal) return false
    return dirty || discardBlank
  })
  // Leaving a blank session (see discardBlank): delete the row so it never lands
  // in history, then continue — no exit sheet. Best-effort; leave even if the
  // delete fails so the user isn't trapped on the page.
  useEffect(() => {
    if (blocker.state !== 'blocked' || !discardBlank || leavingRef.current) return
    leavingRef.current = true
    ;(async () => {
      try {
        await del.mutateAsync(id!)
      } catch {
        /* ignore — proceed regardless */
      }
      blocker.proceed?.()
    })()
  }, [blocker.state, discardBlank])
  // The exit sheet is only for a workout with real content; a blank session is
  // handled silently by the effect above.
  const showExit = blocker.state === 'blocked' && !discardBlank
  // Leave, keeping everything logged this session (already saved live).
  const saveExit = () => {
    leavingRef.current = true
    blocker.proceed?.()
  }
  // Revert this session's edits to the on-open snapshot, then leave. On failure
  // (e.g. offline) stay put so the user isn't misled into thinking it worked.
  const discardChanges = async () => {
    const snap = snapshotRef.current
    if (snap && data) {
      try {
        await restore.mutateAsync({
          workoutId: id!,
          snapshot: snap,
          current: { exercises: data.exercises, sets: data.sets },
        })
      } catch {
        alert('Could not discard changes — check your connection and try again.')
        return
      }
    }
    leavingRef.current = true
    blocker.proceed?.()
  }
  // Save the workout as done, then leave. leavingRef guarantees we exit even
  // before the cache reflects completed=true (so the blocker can't re-fire).
  const finish = async () => {
    leavingRef.current = true
    // Nothing logged → discard rather than save a completed empty workout.
    if (discardBlank) {
      try {
        await del.mutateAsync(id!)
      } catch {
        /* ignore — leave regardless */
      }
      nav('/strength')
      return
    }
    if (workoutId && !workout?.completed)
      await updateWorkout.mutateAsync({ id: workoutId, completed: true })
    nav('/strength')
  }
  const blocks: { group: number | null; exercises: WorkoutExercise[] }[] = []
  const seen = new Set<number>()
  for (const ex of exercises) {
    if (ex.superset_group == null) {
      blocks.push({ group: null, exercises: [ex] })
    } else if (!seen.has(ex.superset_group)) {
      seen.add(ex.superset_group)
      blocks.push({
        group: ex.superset_group,
        exercises: exercises.filter((e) => e.superset_group === ex.superset_group),
      })
    }
  }
  const setsFor = (weId: string) =>
    sets.filter((s) => s.workout_exercise_id === weId)

  // A block (standalone exercise or a superset group) drops into "Completed"
  // once every exercise in it is marked done (ended_at set). Supersets move as
  // a unit — the whole block waits until all its exercises are done.
  const blockDone = (b: { exercises: WorkoutExercise[] }) =>
    b.exercises.every((e) => e.ended_at != null)
  const activeBlocks = blocks.filter((b) => !blockDone(b))
  const completedBlocks = blocks.filter(blockDone)

  const renderBlock = (b: {
    group: number | null
    exercises: WorkoutExercise[]
  }) =>
    // A superset needs ≥2 members. If deleting one leaves a lone exercise in the
    // group, render it as a standalone card so its "Superset" button returns —
    // re-adding reuses the still-set group number, reforming the superset.
    b.group != null && b.exercises.length > 1 ? (
      <SupersetBlock
        key={`sg-${b.group}`}
        group={b.group}
        exercises={b.exercises}
        setsFor={setsFor}
        workoutId={id!}
        onPR={onPR}
        routineTargets={routineTargets}
      />
    ) : (
      <ExerciseCard
        key={b.exercises[0].id}
        ex={b.exercises[0]}
        sets={setsFor(b.exercises[0].id)}
        workoutId={id!}
        onPR={onPR}
        routineTargets={routineTargets}
      />
    )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={workout?.name || 'Workout'}
        subtitle={workout ? dateLabel(workout.workout_date) : ''}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4 pb-32">
        {activeBlocks.map(renderBlock)}

        {completedBlocks.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border">
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="flex w-full items-center gap-2 p-3 text-sm font-semibold active:bg-accent"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  showCompleted ? '' : '-rotate-90',
                )}
              />
              Completed ({completedBlocks.length})
            </button>
            {showCompleted && (
              <div className="space-y-4 border-t border-border p-3">
                {completedBlocks.map(renderBlock)}
              </div>
            )}
          </div>
        )}

        {workout && cardioItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-orange-500">
              <Activity className="h-3.5 w-3.5" /> Cardio
            </div>
            {cardioItems.map((it) => (
              <CardioItemCard key={it.id} item={it} date={workout.workout_date} />
            ))}
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => nav(`/workout/${id}/add-exercise`)}
        >
          <Plus className="h-4 w-4" /> Add exercise
        </Button>
        <Button className="w-full" onClick={finish}>
          {workout?.completed ? (
            <>
              <Check className="h-4 w-4" /> Done
            </>
          ) : (
            'Mark as done'
          )}
        </Button>
      </div>
      {showExit &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => {
              if (!restore.isPending) blocker.reset?.()
            }}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-xs text-muted-foreground">
                  Leave workout?
                </div>
                <button
                  onClick={saveExit}
                  disabled={restore.isPending}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Save &amp; exit</span>
                </button>
                <button
                  onClick={discardChanges}
                  disabled={restore.isPending}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {restore.isPending ? 'Discarding…' : 'Discard changes'}
                  </span>
                </button>
              </Card>
              <button
                onClick={() => blocker.reset?.()}
                disabled={restore.isPending}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
      {currentPR &&
        createPortal(
          <PRBanner
            key={currentPR.id}
            hit={currentPR}
            onDismiss={() => setPrs((q) => q.slice(1))}
          />,
          document.body,
        )}
    </div>
  )
}

// Start/Done control + clock window, shared by a standalone exercise and a
// whole superset block. Start stamps the begin time; Done (toggle) stamps/clears
// the end. `className` defaults to a bottom margin for use inside a card body.
function TimingRow({
  startedAt,
  endedAt,
  onStart,
  onToggleDone,
  className = 'mb-2',
}: {
  startedAt: string | null
  endedAt: string | null
  onStart: () => void
  onToggleDone: () => void
  className?: string
}) {
  const done = endedAt != null
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {done ? (
        <span className="tabular-nums">
          {startedAt ? `${timeLabel(startedAt)}–` : ''}
          {timeLabel(endedAt!)}
        </span>
      ) : startedAt ? (
        <span className="tabular-nums">{timeLabel(startedAt)} –</span>
      ) : (
        <button
          onClick={onStart}
          className="flex items-center gap-1 font-medium text-primary active:opacity-70"
        >
          <Play className="h-3 w-3" /> Start
        </button>
      )}
      <button
        onClick={onToggleDone}
        className={cn(
          'ml-auto flex items-center gap-1 rounded-md px-2 py-1 font-medium',
          done
            ? 'bg-primary text-primary-foreground'
            : 'bg-primary/10 text-primary active:bg-primary/20',
        )}
      >
        <Check className="h-3.5 w-3.5" /> Done
      </button>
    </div>
  )
}

// One programmed cardio item from the source template. Pending: prescription
// chips + a Log button that opens the cardio form prefilled with the targets
// (GPS activities offer the recorder instead). Done: the matching entry logged
// on this workout's date (matched by activity name), with a zone-target check.
function CardioItemCard({
  item,
  date,
}: {
  item: RoutineExercise
  date: string
}) {
  const nav = useNavigate()
  const { data: entries } = useExerciseEntries(date)
  const { data: customActs } = useCustomActivities()
  const actKey = cardioActivityKey(item.exercise_key)
  const act = findCardioActivity(actKey, customActs ?? [])
  const recorder = isRecorderActivity(actKey)
  const chips = cardioTargetChips({
    target_duration_min: item.target_duration_min ?? null,
    target_distance_mi: item.target_distance_mi ?? null,
    target_zone: item.target_zone ?? null,
    intervals: item.intervals ?? null,
  })
  const entry = (entries ?? []).find((en) =>
    entryMatchesCardio(item.exercise_name, en.name),
  )

  const logIt = () => {
    const p = new URLSearchParams()
    p.set('name', item.exercise_name)
    p.set('met', String(act?.met ?? 5))
    if (act?.distanceBased) p.set('distanceBased', '1')
    if (item.target_duration_min)
      p.set('dur', String(item.target_duration_min))
    if (item.target_distance_mi)
      p.set('dist', String(item.target_distance_mi))
    p.set('date', date)
    nav(`/exercise/add?${p.toString()}`)
  }

  if (entry) {
    const zoneTarget = item.target_zone ?? null
    const zoneHit =
      zoneTarget != null && entry.zone != null ? entry.zone === zoneTarget : null
    const parts = [
      entry.duration_min != null ? `${entry.duration_min} min` : null,
      entry.distance_mi != null ? `${entry.distance_mi} mi` : null,
      `${entry.calories} cal`,
    ].filter(Boolean)
    return (
      <Card className="p-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-orange-500" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {item.exercise_name}
          </span>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
          </span>
        </div>
        <p className="mt-1 pl-6 text-sm text-muted-foreground">
          {parts.join(' · ')}
        </p>
        {entry.zone != null && (
          <p className="mt-0.5 pl-6 text-xs">
            <span className="font-medium" style={{ color: zoneColor(entry.zone) }}>
              Zone {entry.zone}
            </span>{' '}
            {zoneHit === true ? (
              <span className="text-success">· target met</span>
            ) : zoneHit === false ? (
              <span className="text-muted-foreground">
                · target Zone {zoneTarget}
              </span>
            ) : null}
          </p>
        )}
      </Card>
    )
  }

  return (
    <Card className="border-orange-500/30 p-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 shrink-0 text-orange-500" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {item.exercise_name}
        </span>
      </div>
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400"
            >
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex gap-2 pl-6">
        {recorder ? (
          <>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => nav(`/exercise/track?activity=${actKey}`)}
            >
              <MapPin className="h-4 w-4" /> Record GPS
            </Button>
            <Button size="sm" variant="outline" onClick={logIt}>
              Log
            </Button>
          </>
        ) : (
          <Button size="sm" className="flex-1" onClick={logIt}>
            Log
            {item.target_duration_min ? ` · ${item.target_duration_min} min` : ''}
          </Button>
        )}
      </div>
    </Card>
  )
}

// A superset: one shared Start/Done for the block (stamps all its exercises
// together), then the member exercise cards with their own timing hidden.
function SupersetBlock({
  group,
  exercises,
  setsFor,
  workoutId,
  onPR,
  routineTargets,
}: {
  group: number
  exercises: WorkoutExercise[]
  setsFor: (weId: string) => WorkoutSet[]
  workoutId: string
  onPR: (hit: Omit<PRHit, 'id'>) => void
  routineTargets?: Map<string, number>
}) {
  const timing = useUpdateSupersetTiming()
  // The block's window is derived from its exercises (stamped together): start
  // = earliest start; the block is done only once every exercise is ended.
  const startedAt =
    exercises
      .map((e) => e.started_at)
      .filter((x): x is string => x != null)
      .sort()[0] ?? null
  const allDone = exercises.every((e) => e.ended_at != null)
  const endedAt = allDone
    ? exercises.map((e) => e.ended_at!).sort().slice(-1)[0]
    : null
  const stamp = (patch: {
    started_at?: string | null
    ended_at?: string | null
  }) => timing.mutate({ workoutId, group, patch })
  // First weight entered in any member auto-starts the whole block at once.
  const maybeAutoStart = () => {
    if (startedAt == null && endedAt == null)
      stamp({ started_at: new Date().toISOString() })
  }

  return (
    <div className="space-y-2 rounded-xl border-2 border-primary/30 p-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
        Superset
      </div>
      <TimingRow
        className=""
        startedAt={startedAt}
        endedAt={endedAt}
        onStart={() => stamp({ started_at: new Date().toISOString() })}
        onToggleDone={() =>
          stamp({ ended_at: allDone ? null : new Date().toISOString() })
        }
      />
      {exercises.map((ex, i) => (
        <ExerciseCard
          key={ex.id}
          ex={ex}
          sets={setsFor(ex.id)}
          workoutId={workoutId}
          label={`${i + 1}`}
          showTiming={false}
          onAutoStart={maybeAutoStart}
          onPR={onPR}
          routineTargets={routineTargets}
        />
      ))}
    </div>
  )
}

function ExerciseCard({
  ex,
  sets,
  workoutId,
  label,
  showTiming = true,
  onAutoStart,
  onPR,
  routineTargets,
}: {
  ex: WorkoutExercise
  sets: WorkoutSet[]
  workoutId: string
  label?: string
  // Standalone exercises carry their own Start/Done; superset members hide it
  // because the block shows a single shared control instead.
  showTiming?: boolean
  // Superset members defer auto-start to the block's shared timer; standalone
  // cards fall back to stamping their own started_at (set below).
  onAutoStart?: () => void
  onPR: (hit: Omit<PRHit, 'id'>) => void
  // Template rep targets by exercise_key — the coach's fallback when the lift
  // has no strength goal.
  routineTargets?: Map<string, number>
}) {
  const nav = useNavigate()
  const addSet = useAddSet()
  const updateSet = useUpdateSet()
  const updateEx = useUpdateExercise()
  const delEx = useDeleteExercise()
  const lastNote = useLastExerciseNote(ex.exercise_key, workoutId)
  const [notes, setNotes] = useState(ex.notes ?? '')
  const [warmupOpen, setWarmupOpen] = useState(false)

  // Warm-up ramp to set 1's weight. Built-in bodyweight/timed lifts don't get
  // one; custom exercises (no meta) are treated as weighted, non-barbell.
  const meta = EXERCISES.find((e) => e.key === ex.exercise_key)
  // Stretches and planks log a hold in seconds instead of reps × weight. Custom
  // exercises carry their own type, so look those up too.
  const { data: customExercises } = useCustomExercises()
  const customKind = ex.exercise_key.startsWith('custom:')
    ? customExercises?.find((c) => `custom:${c.id}` === ex.exercise_key)?.type
    : undefined
  const hold = isHoldKind(meta?.kind ?? customKind)
  const warmupEligible = !hold && (meta == null || meta.kind === 'weighted')
  const workingLb = sets[0]?.weight_lb ?? null
  const ramp =
    workingLb != null ? warmupRamp(workingLb, meta?.equipment === 'Barbell') : []

  const best = sets.reduce(
    (m, s) => Math.max(m, estimated1RM(s.weight_lb ?? 0, s.reps ?? 0)),
    0,
  )

  // ---- PR detection (vs PRIOR workouts; bests is null when there's nothing to
  // beat). Per SET, and can fire more than once a session: each set that pushes
  // past the running high-water mark celebrates — not just the first. ----
  const { data: bests } = useExerciseBests(ex.exercise_key, workoutId)
  const weightMark = useRef<number | null>(null)
  const volMark = useRef<number | null>(null)
  useEffect(() => {
    if (!bests) return
    // This session's heaviest single set + its biggest single-set volume.
    let sessionWeight = 0
    let sessionVol = 0
    let volW = 0
    let volR = 0
    for (const s of sets) {
      const w = s.weight_lb ?? 0
      const r = s.reps ?? 0
      if (w > sessionWeight) sessionWeight = w
      if (w > 0 && r > 0 && w * r > sessionVol) {
        sessionVol = w * r
        volW = w
        volR = r
      }
    }
    // Seed the marks once (include what's already logged) so opening/reopening
    // an exercise doesn't re-celebrate sets that already exist.
    if (weightMark.current === null) {
      weightMark.current = Math.max(bests.maxWeight, sessionWeight)
      volMark.current = Math.max(bests.maxSetVolume, sessionVol)
      return
    }
    // Heaviest-weight PR — needs a real prior weight so a first-ever weighted
    // set doesn't read as "beat 0".
    if (bests.maxWeight > 0 && sessionWeight > weightMark.current) {
      const prev = weightMark.current
      weightMark.current = sessionWeight
      onPR({ metric: 'weight', name: ex.exercise_name, value: sessionWeight, prev })
    }
    // Biggest single-set volume PR (one set's reps × weight), once it's logged.
    if (bests.maxSetVolume > 0 && sessionVol > (volMark.current ?? 0)) {
      const prev = volMark.current ?? 0
      volMark.current = sessionVol
      onPR({
        metric: 'volume',
        name: ex.exercise_name,
        value: sessionVol,
        prev,
        detail: `${volW} × ${volR}`,
      })
    }
  }, [sets, bests, ex.exercise_name, onPR])

  // Session-volume PR: fires once when the exercise is marked done (ended_at
  // null → set), if this session's total tonnage beats the best-ever session.
  // Seeded on first load so reopening a done exercise doesn't re-fire.
  const prevEnded = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!bests) return
    if (prevEnded.current === undefined) {
      prevEnded.current = ex.ended_at
      return
    }
    if (prevEnded.current == null && ex.ended_at != null) {
      const total = sets.reduce(
        (sum, s) => sum + (s.reps ?? 0) * (s.weight_lb ?? 0),
        0,
      )
      if (bests.maxSessionVolume > 0 && total > bests.maxSessionVolume)
        onPR({
          metric: 'session',
          name: ex.exercise_name,
          value: total,
          prev: bests.maxSessionVolume,
        })
    }
    prevEnded.current = ex.ended_at
  }, [ex.ended_at, sets, bests, ex.exercise_name, onPR])

  const addSetRow = () => {
    addSet.mutate({
      workout_id: workoutId,
      workout_exercise_id: ex.id,
      exercise_key: ex.exercise_key,
      exercise_name: ex.exercise_name,
      set_number: sets.length + 1,
      reps: null,
      weight_lb: null,
    })
  }

  // Whole-exercise timing: Start stamps the beginning of the first set, Done
  // stamps the end (and rolls the exercise into "Completed"). Tapping the
  // filled Done again clears ended_at and reopens the exercise.
  const done = ex.ended_at != null
  const stamp = (patch: Partial<WorkoutExercise>) =>
    updateEx.mutate({ id: ex.id, workoutId, ...patch })
  // First weight entered auto-starts the timer (no need to tap Start). A
  // superset member hands this to the block; a standalone stamps its own start.
  // Guarded so it only fires once, and never on an already-done exercise.
  const autoStart =
    onAutoStart ??
    (() => {
      if (ex.started_at == null && ex.ended_at == null)
        stamp({ started_at: new Date().toISOString() })
    })

  // Which rows have been filled in during this visit. A goal'd lift's set rows
  // arrive PRE-FILLED with the next-session suggestion (see useAddExercise), so
  // "has weight + reps" can't tell a set you performed from an untouched
  // prefill — the feedback strip and the coach only follow a row you've typed
  // in. Reopening the workout clears this, so they stay quiet until the next
  // set is logged rather than re-asking about old ones.
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const markLogged = useCallback((id: string) => {
    setTouched((t) => (t.has(id) ? t : new Set(t).add(id)))
  }, [])

  // Post-set feedback asks on the most recently completed set; earlier rows keep
  // their chips only once an answer is saved.
  let lastDoneIdx = -1
  if (!hold)
    sets.forEach((s, i) => {
      if (s.weight_lb != null && s.reps != null && touched.has(s.id))
        lastDoneIdx = i
    })

  // The next-set coach reads that set (RPE + feel/pain) and says what to do on
  // the next one. Hidden on hold exercises and once the exercise is done.
  const { data: goalMap } = useStrengthGoalMap()
  const lastDone = lastDoneIdx >= 0 ? sets[lastDoneIdx] : null
  const coach =
    lastDone && !done
      ? suggestNextSet(lastDone, {
          goal: goalMap?.get(ex.exercise_key) ?? null,
          fallbackReps:
            routineTargets?.get(ex.exercise_key) ?? sets[0]?.reps ?? null,
          setsDone: lastDoneIdx + 1,
        })
      : null

  // Load the suggestion into the next row: the first empty one after the set it
  // read, or a fresh row when every row is filled.
  const applyCoach = () => {
    if (!coach) return
    const patch = { weight_lb: coach.weightLb, reps: coach.reps }
    const blank = sets.findIndex(
      (s, i) => i > lastDoneIdx && s.weight_lb == null && s.reps == null,
    )
    if (blank >= 0)
      updateSet.mutate({ id: sets[blank].id, workout_id: workoutId, ...patch })
    else
      addSet.mutate({
        workout_id: workoutId,
        workout_exercise_id: ex.id,
        exercise_key: ex.exercise_key,
        exercise_name: ex.exercise_name,
        set_number: sets.length + 1,
        ...patch,
      })
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border p-3">
        {label && (
          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-xs font-bold text-primary">
            {label}
          </span>
        )}
        <button
          className="flex-1 text-left font-semibold"
          onClick={() => nav(`/lift/exercise/${ex.exercise_key}`)}
        >
          {ex.exercise_name}
        </button>
        {best > 0 && (
          <span className="text-xs text-muted-foreground">
            e1RM {Math.round(best)}
          </span>
        )}
        <button
          onClick={() => {
            if (confirm(`Remove ${ex.exercise_name}?`))
              delEx.mutate({ id: ex.id, workoutId })
          }}
          className="text-muted-foreground active:text-destructive"
          aria-label="Remove exercise"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-2">
        {showTiming && (
          <TimingRow
            startedAt={ex.started_at}
            endedAt={ex.ended_at}
            onStart={() => stamp({ started_at: new Date().toISOString() })}
            onToggleDone={() =>
              stamp({ ended_at: done ? null : new Date().toISOString() })
            }
          />
        )}
        {warmupEligible && (
          <div className="mb-1.5 rounded-md bg-primary/10 px-2 py-1.5">
            <button
              onClick={() => setWarmupOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 text-xs font-medium text-primary"
            >
              <Flame className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Warm-up</span>
              {warmupOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            {warmupOpen &&
              (workingLb == null ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Enter a weight for set 1 to get a ramp.
                </p>
              ) : ramp.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Light working weight — no warm-up needed.
                </p>
              ) : (
                <>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ramp.map((s) => (
                      <span
                        key={s.weightLb}
                        className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs text-primary"
                      >
                        {s.isBar ? 'Bar' : s.weightLb} × {s.reps}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    From set 1 · {workingLb} lb · not logged as sets
                  </p>
                </>
              ))}
          </div>
        )}
        <div
          className={cn(
            'grid gap-2 px-1 pb-1 text-xs text-muted-foreground',
            hold
              ? 'grid-cols-[2rem_1fr_3.5rem_1.5rem]'
              : 'grid-cols-[2rem_1fr_1fr_3.5rem_1.5rem]',
          )}
        >
          <span className="text-center">Set</span>
          {hold ? (
            <span>Hold (sec)</span>
          ) : (
            <>
              <span>lb</span>
              <span>Reps</span>
            </>
          )}
          <span className="text-center">RPE</span>
          <span />
        </div>
        {sets.map((s, i) => (
          <SetRow
            key={s.id}
            set={s}
            index={i + 1}
            workoutId={workoutId}
            hold={hold}
            onWeightEntered={autoStart}
            onLogged={markLogged}
            feedback={i === lastDoneIdx}
          />
        ))}
        <button
          onClick={addSetRow}
          className="mt-1 w-full rounded-md py-2 text-sm font-medium text-primary active:bg-accent"
        >
          + Add set
        </button>
        {coach && (
          <CoachCard
            s={coach}
            onUse={applyCoach}
            onEnd={() => stamp({ ended_at: new Date().toISOString() })}
          />
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (ex.notes ?? ''))
              updateEx.mutate({ id: ex.id, workoutId, notes: notes || null })
          }}
          placeholder={
            lastNote.data ? `Last time: ${lastNote.data}` : 'Notes for this session…'
          }
          rows={2}
          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {label == null && (
          <button
            onClick={() =>
              nav(`/workout/${workoutId}/add-exercise?supersetWith=${ex.id}`)
            }
            className="mt-1 flex w-full items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium text-muted-foreground active:bg-accent"
          >
            <Link2 className="h-3.5 w-3.5" /> Superset
          </button>
        )}
      </div>
    </Card>
  )
}

// The next-set coach: what to do on the next set, why, and one tap to load it
// into the row. A plain "you're in the pocket" hold stays neutral on purpose —
// only adding load, a corrective hold, a back-off or a stop earns a colour, so
// an ordinary set doesn't read as an event.
function CoachCard({
  s,
  onUse,
  onEnd,
}: {
  s: NextSetSuggestion
  onUse: () => void
  onEnd: () => void
}) {
  const alarm = s.action === 'stop'
  const warn = s.action === 'backoff' || s.caution
  const tone = alarm
    ? 'bg-destructive/10 text-destructive'
    : warn
      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
      : s.action === 'increase'
        ? 'bg-primary/10 text-primary'
        : 'bg-secondary text-foreground'
  const Icon = alarm
    ? AlertTriangle
    : s.action === 'increase'
      ? TrendingUp
      : s.action === 'backoff'
        ? TrendingDown
        : Minus
  const target = s.weightLb == null ? s.headline : `${s.weightLb} lb × ${s.reps}`
  return (
    <div className={cn('mt-1.5 rounded-md p-2.5', tone)}>
      <div className="flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-sm font-semibold">
          {alarm ? 'Stop for today' : `Next: ${s.headline}`}
        </span>
        {s.amrap && (
          <span className="rounded-full bg-background/60 px-1.5 py-0.5 text-[10px] font-medium">
            AMRAP
          </span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-90">{s.rationale}</p>
      <div className="mt-2 flex gap-1.5">
        {alarm && (
          <button
            onClick={onEnd}
            className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground active:opacity-80"
          >
            End exercise
          </button>
        )}
        <button
          onClick={onUse}
          className="rounded-md bg-background/70 px-2.5 py-1 text-xs font-medium active:opacity-80"
        >
          {alarm ? `Keep going light · ${target}` : `Use ${target}`}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] opacity-70">{s.source}</p>
    </div>
  )
}

// Pain-site options for the post-set feedback strip (stored lowercase on
// workout_sets.pain; null = no pain).
const PAIN_SITES = [
  'shoulder',
  'elbow',
  'wrist',
  'low back',
  'hip',
  'knee',
  'other',
]
const painLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function SetRow({
  set,
  index,
  workoutId,
  hold,
  onWeightEntered,
  onLogged,
  feedback,
}: {
  set: WorkoutSet
  index: number
  workoutId: string
  // Hold exercises (stretches, planks) log seconds in place of lb × reps.
  hold: boolean
  // Auto-start the parent exercise's timer the first time a weight is logged.
  onWeightEntered: () => void
  // This row was filled in by hand (vs. arriving prefilled) — tells the parent
  // which set the feedback strip and the coach should follow.
  onLogged: (id: string) => void
  // Show the "how was it?" strip (the exercise's most recently completed set).
  feedback: boolean
}) {
  const [weight, setWeight] = useState(
    set.weight_lb != null ? String(set.weight_lb) : '',
  )
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : '')
  const [secs, setSecs] = useState(
    set.duration_sec != null ? String(set.duration_sec) : '',
  )
  const update = useUpdateSet()
  const del = useDeleteSet()
  const save = (patch: Partial<WorkoutSet>) =>
    update.mutate({ id: set.id, workout_id: workoutId, ...patch })
  // Pain chip tapped but no site picked yet — the site row is open.
  const [painPick, setPainPick] = useState(false)

  // Weight/reps can now be written from outside the row (the coach's "Use"
  // fills the next set), so mirror prop changes into the inputs — but never
  // over a field currently being typed in, which would clobber the entry.
  const wFocus = useRef(false)
  const rFocus = useRef(false)
  useEffect(() => {
    if (!wFocus.current)
      setWeight(set.weight_lb != null ? String(set.weight_lb) : '')
  }, [set.weight_lb])
  useEffect(() => {
    if (!rFocus.current) setReps(set.reps != null ? String(set.reps) : '')
  }, [set.reps])

  return (
    <div className="py-1">
      <div
        className={cn(
          'grid items-center gap-2',
          hold
            ? 'grid-cols-[2rem_1fr_3.5rem_1.5rem]'
            : 'grid-cols-[2rem_1fr_1fr_3.5rem_1.5rem]',
        )}
      >
        <span className="text-center text-sm text-muted-foreground">{index}</span>
        {hold ? (
          <Input
            className="h-9"
            type="number"
            inputMode="numeric"
            value={secs}
            onChange={(e) => setSecs(e.target.value)}
            onBlur={() => {
              const d = secs ? parseFloat(secs) : null
              save({ duration_sec: d })
              if (d != null && !Number.isNaN(d)) onWeightEntered()
            }}
          />
        ) : (
          <>
            <Input
              className="h-9"
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onFocus={() => {
                wFocus.current = true
              }}
              onBlur={() => {
                wFocus.current = false
                const w = weight ? parseFloat(weight) : null
                save({ weight_lb: w })
                if (w != null && !Number.isNaN(w)) {
                  onWeightEntered()
                  onLogged(set.id)
                }
              }}
            />
            <Input
              className="h-9"
              type="number"
              inputMode="numeric"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              onFocus={() => {
                rFocus.current = true
              }}
              onBlur={() => {
                rFocus.current = false
                const r = reps ? parseFloat(reps) : null
                save({ reps: r })
                if (r != null && !Number.isNaN(r)) onLogged(set.id)
              }}
            />
          </>
        )}
        <Select
          className="h-9 px-1"
          value={set.effort != null ? String(set.effort) : ''}
          onChange={(e) => {
            save({ effort: e.target.value ? parseInt(e.target.value) : null })
            // Rating a prefilled row is often the only edit a goal'd lift needs,
            // so it counts as logging the set.
            if (e.target.value) onLogged(set.id)
          }}
        >
          <option value="">–</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <button
          onClick={() => del.mutate({ id: set.id, workout_id: workoutId })}
          className="text-muted-foreground active:text-destructive"
          aria-label="Delete set"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {!hold && (feedback || set.feel != null || set.pain != null) && (
        <div className="mt-1 pl-10 pr-7">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[11px] text-muted-foreground">
              Felt
            </span>
            <button
              onClick={() => save({ feel: set.feel === 'good' ? null : 'good' })}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs',
                set.feel === 'good'
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              Good
            </button>
            <button
              onClick={() => save({ feel: set.feel === 'off' ? null : 'off' })}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs',
                set.feel === 'off'
                  ? 'bg-amber-500/15 font-medium text-amber-600 dark:text-amber-400'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              Off
            </button>
            <button
              onClick={() => {
                if (set.pain != null) {
                  save({ pain: null })
                  setPainPick(false)
                } else setPainPick((p) => !p)
              }}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs',
                set.pain != null
                  ? 'bg-destructive/15 font-medium text-destructive'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              {set.pain != null ? `Pain · ${painLabel(set.pain)}` : 'Pain'}
            </button>
          </div>
          {painPick && set.pain == null && (
            <div className="mt-1 flex flex-wrap gap-1">
              {PAIN_SITES.map((site) => (
                <button
                  key={site}
                  onClick={() => {
                    save({ pain: site })
                    setPainPick(false)
                  }}
                  className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive"
                >
                  {painLabel(site)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const CONFETTI = ['#22c55e', '#eab308', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa']

// Celebration banner: slides down from the top with a one-shot CSS confetti
// burst, auto-dismisses (parent timer) or on tap. Pure CSS — no dependency.
function PRBanner({ hit, onDismiss }: { hit: PRHit; onDismiss: () => void }) {
  // Randomized confetti, fixed for this banner instance (keyed on hit.id).
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        left: Math.round((i / 18) * 100 + Math.random() * 5),
        bg: CONFETTI[i % CONFETTI.length],
        delay: Math.round(Math.random() * 250),
        dur: 900 + Math.round(Math.random() * 700),
      })),
    [hit.id],
  )
  const lb = (n: number) => Math.round(n).toLocaleString()
  const title =
    hit.metric === 'weight'
      ? 'Heaviest set!'
      : hit.metric === 'volume'
        ? 'Best set volume!'
        : 'Best session volume!'
  const value =
    hit.metric === 'weight'
      ? `${hit.value} lb`
      : hit.metric === 'volume'
        ? `${hit.detail} = ${lb(hit.value)} lb`
        : `${lb(hit.value)} lb total`
  const prev = hit.metric === 'weight' ? `${hit.prev} lb` : `${lb(hit.prev)} lb`

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] mx-auto flex max-w-md justify-center px-4 pt-3">
      <style>{`
@keyframes pr-banner-in { from { transform: translateY(-130%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
@keyframes pr-confetti { 0% { transform: translateY(-8px) rotate(0deg); opacity: 1 } 100% { transform: translateY(72px) rotate(560deg); opacity: 0 } }
`}</style>
      <button
        onClick={onDismiss}
        style={{ animation: 'pr-banner-in 300ms ease-out' }}
        className="pointer-events-auto relative w-full overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg"
      >
        <div className="pointer-events-none absolute inset-0">
          {pieces.map((p, i) => (
            <span
              key={i}
              className="absolute top-0 h-2 w-1.5 rounded-sm"
              style={{
                left: `${p.left}%`,
                background: p.bg,
                animation: `pr-confetti ${p.dur}ms ease-in ${p.delay}ms both`,
              }}
            />
          ))}
        </div>
        <div className="relative flex items-center gap-3 px-4 py-3">
          <span className="text-2xl leading-none">🏆</span>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-sm font-bold leading-tight">{title}</div>
            <div className="truncate text-xs opacity-90">
              {hit.name} · {value}{' '}
              <span className="opacity-75">(beat {prev})</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
