import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronDown,
  Plus,
  X,
  Link2,
  Save,
  Trash2,
  Check,
  Play,
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
  useDeleteWorkout,
  useExerciseBests,
} from '@/features/strength/useStrength'
import { useRegisterRestTimer } from '@/components/strength/RestTimerProvider'
import { estimated1RM } from '@/lib/calc'
import { dateLabel, timeLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { WorkoutExercise, WorkoutSet } from '@/lib/database.types'

// A personal-record hit, surfaced as a celebration banner. `value` is the new
// best, `prev` the old one it beat. Weight PRs fire live as a set is logged;
// volume PRs fire when an exercise is marked done.
type PRHit = {
  id: number
  metric: 'weight' | 'volume'
  name: string
  value: number
  prev: number
}

export function WorkoutPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [showCompleted, setShowCompleted] = useState(false)
  const updateWorkout = useUpdateWorkout()
  const { data } = useWorkout(id)
  const workout = data?.workout
  const exercises = data?.exercises ?? []
  const sets = data?.sets ?? []

  // PR celebration queue: exercise cards report hits up here; we show one banner
  // at a time and auto-dismiss it after a few seconds (tap dismisses early).
  const [prs, setPrs] = useState<PRHit[]>([])
  const prIdRef = useRef(0)
  const onPR = useCallback((hit: Omit<PRHit, 'id'>) => {
    setPrs((q) => [...q, { ...hit, id: ++prIdRef.current }])
  }, [])
  useEffect(() => {
    if (!prs.length) return
    const t = setTimeout(() => setPrs((q) => q.slice(1)), 3500)
    return () => clearTimeout(t)
  }, [prs])
  const currentPR = prs[0]

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

  // Pressing back (arrow or Android system gesture) asks whether to keep an
  // in-progress workout; discard deletes it (sets + exercises cascade). Once
  // the workout is marked done (the Done button) the prompt is skipped — back
  // just navigates. Navigations deeper into the workout (add exercise, an
  // exercise's stats) pass through, and leavingRef lets Done exit cleanly.
  const del = useDeleteWorkout()
  const leavingRef = useRef(false)
  const blocker = useBlocker(({ nextLocation }) => {
    if (leavingRef.current || workout?.completed) return false
    const p = nextLocation.pathname
    const internal =
      p.startsWith(`/workout/${id}`) || p.startsWith('/lift/exercise/')
    return !internal
  })
  const showExit = blocker.state === 'blocked'
  // Save the workout as done, then leave. leavingRef guarantees we exit even
  // before the cache reflects completed=true (so the blocker can't re-fire).
  const finish = async () => {
    leavingRef.current = true
    if (workoutId && !workout?.completed)
      await updateWorkout.mutateAsync({ id: workoutId, completed: true })
    nav('/strength')
  }
  const discardWorkout = async () => {
    if (id) await del.mutateAsync(id)
    blocker.proceed?.()
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
      />
    ) : (
      <ExerciseCard
        key={b.exercises[0].id}
        ex={b.exercises[0]}
        sets={setsFor(b.exercises[0].id)}
        workoutId={id!}
        onPR={onPR}
      />
    )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
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
            onClick={() => blocker.reset?.()}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-xs text-muted-foreground">
                  Save this workout?
                </div>
                <button
                  onClick={() => blocker.proceed?.()}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
                >
                  <Save className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Save workout</span>
                </button>
                <button
                  onClick={discardWorkout}
                  disabled={del.isPending}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {del.isPending ? 'Discarding…' : 'Discard workout'}
                  </span>
                </button>
              </Card>
              <button
                onClick={() => blocker.reset?.()}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
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

// A superset: one shared Start/Done for the block (stamps all its exercises
// together), then the member exercise cards with their own timing hidden.
function SupersetBlock({
  group,
  exercises,
  setsFor,
  workoutId,
  onPR,
}: {
  group: number
  exercises: WorkoutExercise[]
  setsFor: (weId: string) => WorkoutSet[]
  workoutId: string
  onPR: (hit: Omit<PRHit, 'id'>) => void
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
          onPR={onPR}
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
  onPR,
}: {
  ex: WorkoutExercise
  sets: WorkoutSet[]
  workoutId: string
  label?: string
  // Standalone exercises carry their own Start/Done; superset members hide it
  // because the block shows a single shared control instead.
  showTiming?: boolean
  onPR: (hit: Omit<PRHit, 'id'>) => void
}) {
  const nav = useNavigate()
  const addSet = useAddSet()
  const updateEx = useUpdateExercise()
  const delEx = useDeleteExercise()
  const lastNote = useLastExerciseNote(ex.exercise_key, workoutId)
  const [notes, setNotes] = useState(ex.notes ?? '')

  const best = sets.reduce(
    (m, s) => Math.max(m, estimated1RM(s.weight_lb ?? 0, s.reps ?? 0)),
    0,
  )

  // ---- PR detection (against prior workouts only; null = nothing to beat) ----
  const { data: bests } = useExerciseBests(ex.exercise_key, workoutId)

  // Heaviest-weight PR fires live: the first time this session's top set beats
  // the all-time best. Seeds on first load (and on remount) so an already-PR'd
  // session doesn't re-celebrate; fires at most once per exercise per session.
  const weightSeeded = useRef(false)
  const weightHit = useRef(false)
  useEffect(() => {
    if (!bests) return
    const sessionMax = sets.reduce((m, s) => Math.max(m, s.weight_lb ?? 0), 0)
    if (!weightSeeded.current) {
      weightSeeded.current = true
      if (sessionMax > bests.maxWeight) weightHit.current = true
      return
    }
    if (!weightHit.current && bests.maxWeight > 0 && sessionMax > bests.maxWeight) {
      weightHit.current = true
      onPR({
        metric: 'weight',
        name: ex.exercise_name,
        value: sessionMax,
        prev: bests.maxWeight,
      })
    }
  }, [sets, bests, ex.exercise_name, onPR])

  // Volume PR fires when the exercise is marked done (ended_at goes null →
  // set): compare this session's total tonnage to the best-ever session. Only
  // the done transition fires, so editing sets afterward won't re-trigger.
  const prevEnded = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!bests) return
    if (prevEnded.current === undefined) {
      prevEnded.current = ex.ended_at
      return
    }
    if (prevEnded.current == null && ex.ended_at != null) {
      const vol = sets.reduce(
        (sum, s) => sum + (s.reps ?? 0) * (s.weight_lb ?? 0),
        0,
      )
      if (bests.maxVolume > 0 && vol > bests.maxVolume)
        onPR({
          metric: 'volume',
          name: ex.exercise_name,
          value: vol,
          prev: bests.maxVolume,
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
        <div className="grid grid-cols-[2rem_1fr_1fr_3.5rem_1.5rem] gap-2 px-1 pb-1 text-xs text-muted-foreground">
          <span className="text-center">Set</span>
          <span>lb</span>
          <span>Reps</span>
          <span className="text-center">RPE</span>
          <span />
        </div>
        {sets.map((s, i) => (
          <SetRow key={s.id} set={s} index={i + 1} workoutId={workoutId} />
        ))}
        <button
          onClick={addSetRow}
          className="mt-1 w-full rounded-md py-2 text-sm font-medium text-primary active:bg-accent"
        >
          + Add set
        </button>
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

function SetRow({
  set,
  index,
  workoutId,
}: {
  set: WorkoutSet
  index: number
  workoutId: string
}) {
  const [weight, setWeight] = useState(
    set.weight_lb != null ? String(set.weight_lb) : '',
  )
  const [reps, setReps] = useState(set.reps != null ? String(set.reps) : '')
  const update = useUpdateSet()
  const del = useDeleteSet()
  const save = (patch: Partial<WorkoutSet>) =>
    update.mutate({ id: set.id, workout_id: workoutId, ...patch })

  return (
    <div className="py-1">
      <div className="grid grid-cols-[2rem_1fr_1fr_3.5rem_1.5rem] items-center gap-2">
        <span className="text-center text-sm text-muted-foreground">{index}</span>
        <Input
          className="h-9"
          type="number"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={() => save({ weight_lb: weight ? parseFloat(weight) : null })}
        />
        <Input
          className="h-9"
          type="number"
          inputMode="numeric"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          onBlur={() => save({ reps: reps ? parseFloat(reps) : null })}
        />
        <Select
          className="h-9 px-1"
          value={set.effort != null ? String(set.effort) : ''}
          onChange={(e) =>
            save({ effort: e.target.value ? parseInt(e.target.value) : null })
          }
        >
          <option value="">–</option>
          {[1, 2, 3, 4, 5].map((n) => (
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
  const isWeight = hit.metric === 'weight'
  const fmt = (n: number) =>
    isWeight ? `${n} lb` : `${Math.round(n).toLocaleString()} lb`
  const title = isWeight ? 'New top set!' : 'New volume PR!'

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
              {hit.name} · {fmt(hit.value)}{' '}
              <span className="opacity-75">(beat {fmt(hit.prev)})</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
