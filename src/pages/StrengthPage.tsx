import { RecoverySheet, useWorkoutCheckin } from '@/components/WorkoutCheckinSheet'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Plus,
  Brain,
  Dumbbell,
  Play,
  Pencil,
  CalendarClock,
  PersonStanding,
  ClipboardList,
  List,
  Target,
  HeartPulse,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { PreWorkoutFuelTile } from '@/components/PreWorkoutFuel'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useWorkouts,
  useWorkout,
} from '@/features/strength/useStrength'
import { useRoutines } from '@/features/strength/useRoutines'
import { useRoutineMeta } from '@/features/strength/useRoutineMeta'
import { useRehab } from '@/features/rehab/useRehab'
import { activeInjuries } from '@/lib/rehab'
import { useProfile } from '@/features/profile/useProfile'
import { nextRoutineId } from '@/lib/progression'
import { nextProgramRoutineId } from '@/lib/program'
import { todayISO, daysBetweenISO, timeLabel } from '@/lib/date'

/** Compact "last done" label so the hero meta line stays on one row:
 *  today / yesterday / weekday within the week, else a short date. */
function lastDoneLabel(iso: string): string {
  const diff = daysBetweenISO(iso, todayISO())
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(
    undefined,
    diff < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' },
  )
}

const TILE =
  'relative flex h-16 flex-col items-center justify-center gap-1 rounded-xl bg-card text-xs text-muted-foreground active:bg-accent disabled:opacity-50'

function NavTile({
  icon: Icon,
  label,
  aria = label,
  alert = 0,
  onClick,
}: {
  icon: LucideIcon
  label: string
  aria?: string
  alert?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={alert > 0 ? `${aria} — ${alert} open` : aria}
      className={TILE}
    >
      <Icon className="h-5 w-5 text-foreground" />
      {label}
      {alert > 0 && (
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
      )}
    </button>
  )
}

export function StrengthPage() {
  const nav = useNavigate()
  const { data: workouts } = useWorkouts()
  const { data: routines } = useRoutines()
  const { data: profile } = useProfile()
  // ?recovery=<workoutId> — the 9:00 "how's your body?" notification lands here.
  const [params, setParams] = useSearchParams()
  const recoveryId = params.get('recovery')
  const checkin = useWorkoutCheckin()
  const [menuOpen, setMenuOpen] = useState(false)
  // The Rehab tile grows a red dot while an injury is open.
  const { state: rehab } = useRehab()
  const openInjuries = activeInjuries(rehab)

  // Next template in the rotation: the one after your most recently trained
  // template (wraps around, skipping rest). Uses your Program if you've set one
  // up, otherwise falls back to a simple rotation over all templates.
  const nextRoutine = useMemo(() => {
    const program = profile?.program
    const id =
      program && program.sequence?.length
        ? nextProgramRoutineId(program.sequence, workouts ?? [], program.nextOverride)
        : nextRoutineId(routines ?? [], workouts ?? [])
    return (routines ?? []).find((r) => r.id === id) ?? null
  }, [profile, routines, workouts])

  // The session you walked away from: today's workout that you never marked
  // as done. `completed` only flips on Mark as done, so backgrounding the app
  // mid-workout leaves the row resumable. useWorkouts is already sorted newest
  // first, so find() picks the latest if you somehow started two.
  const inProgress = useMemo(
    () =>
      (workouts ?? []).find(
        (w) => !w.completed && w.workout_date === todayISO(),
      ) ?? null,
    [workouts],
  )
  // Fetching it here doubles as a prefetch: WorkoutPage reads the same
  // ['workout', id] cache entry, so Continue lands on a filled-in page.
  const { data: live } = useWorkout(inProgress?.id)

  const progressLine = useMemo(() => {
    const exercises = live?.exercises ?? []
    if (exercises.length === 0) return 'Pick up where you left off'
    const done = exercises.filter((e) => e.ended_at != null).length
    const started = exercises
      .map((e) => e.started_at)
      .filter((t): t is string => t != null)
      .sort()[0]
    const parts = [`${done} of ${exercises.length} exercises`]
    if (started) parts.push(`started ${timeLabel(started)}`)
    return parts.join(' · ')
  }, [live])

  const { data: meta } = useRoutineMeta(nextRoutine?.id)

  const metaLine = useMemo(() => {
    if (!meta) return ''
    const parts: string[] = []
    if (meta.exerciseCount > 0)
      parts.push(
        `${meta.exerciseCount} exercise${meta.exerciseCount === 1 ? '' : 's'}`,
      )
    if (meta.estMinutes != null) parts.push(`~${meta.estMinutes} min`)
    if (meta.lastDone) parts.push(`last done ${lastDoneLabel(meta.lastDone)}`)
    return parts.join(' · ')
  }, [meta])

  const startEmpty = async () => {
    const id = await checkin.start({ name: 'Workout', date: todayISO() })
    if (id) nav(`/workout/${id}`)
  }
  const startNext = async () => {
    if (!nextRoutine) return
    const id = await checkin.start({
      routineId: nextRoutine.id,
      name: nextRoutine.name,
      date: todayISO(),
    })
    if (id) nav(`/workout/${id}`)
  }

  return (
    <div className="flex min-h-[calc(100svh-4.25rem-env(safe-area-inset-bottom))] flex-col">
      {checkin.sheet}
      {recoveryId && (
        <RecoverySheet
          workoutId={recoveryId}
          onClose={() => setParams({}, { replace: true })}
        />
      )}
      <PageHeader
        title="Exercise"
        action={
          <Button size="icon" onClick={() => setMenuOpen(true)} aria-label="Add">
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 px-4 pb-4 pt-2">
        <Card className="min-h-36 p-4">
          {inProgress ? (
            <>
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                In progress
              </span>
              <h2 className="mt-1 truncate text-2xl font-bold">
                {inProgress.name || 'Workout'}
              </h2>
              <p className="min-h-5 text-sm text-muted-foreground">
                {progressLine}
              </p>
              <Button
                className="mt-3 w-full"
                onClick={() => nav(`/workout/${inProgress.id}`)}
              >
                <Play className="h-4 w-4" /> Continue workout
              </Button>
            </>
          ) : routines === undefined ? null : nextRoutine ? (
            <>
              <button
                type="button"
                onClick={() => nav('/program')}
                aria-label="Edit program"
                className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"
              >
                Next up
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <h2 className="mt-1 truncate text-2xl font-bold">
                {nextRoutine.name}
              </h2>
              <p className="min-h-5 text-sm text-muted-foreground">
                {metaLine}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Button
                  className="flex-1"
                  onClick={startNext}
                  disabled={checkin.isPending}
                >
                  <Play className="h-4 w-4" />
                  {checkin.isPending ? 'Starting…' : 'Start workout'}
                </Button>
                {/* Full session stays one tap; the budget screen is opt-in. */}
                <button
                  type="button"
                  className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => nav(`/routines/${nextRoutine.id}/start`)}
                >
                  Short on time?
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold">No rotation yet</h2>
              <p className="text-sm text-muted-foreground">
                Create a workout template and your next session will queue up
                here.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button className="flex-1" onClick={() => nav('/routines/new')}>
                  <ClipboardList className="h-4 w-4" /> New template
                </Button>
                <Button
                  variant="ghost"
                  className="text-primary"
                  onClick={startEmpty}
                  disabled={checkin.isPending}
                >
                  <Dumbbell className="h-4 w-4" />
                  {checkin.isPending ? 'Starting…' : 'Start empty workout'}
                </Button>
              </div>
            </>
          )}
        </Card>

        <div className="grid grid-cols-4 gap-2">
          <PreWorkoutFuelTile className={cn(TILE, 'col-span-2')} />
          <NavTile icon={Brain} label="Trainer" aria="Ask a trainer" onClick={() => nav('/lift/trainer')} />
          <NavTile icon={ClipboardList} label="Templates" onClick={() => nav('/lift/templates')} />
          <NavTile icon={CalendarClock} label="History" onClick={() => nav('/lift/history')} />
          <NavTile icon={Target} label="Goals" onClick={() => nav('/lift/goals')} />
          <NavTile icon={PersonStanding} label="Muscles" onClick={() => nav('/lift/volume')} />
          <NavTile
            icon={HeartPulse}
            label="Rehab"
            alert={openInjuries.length}
            onClick={() => nav('/rehab')}
          />
        </div>
      </div>

      {menuOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setMenuOpen(false)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-xs text-muted-foreground">
                  Add
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    startEmpty()
                  }}
                  disabled={checkin.isPending}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent disabled:opacity-50"
                >
                  <Dumbbell className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Empty workout</span>
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    nav('/routines/new')
                  }}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left active:bg-accent"
                >
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Template</span>
                </button>
                <div className="border-y border-border p-3 text-center text-xs text-muted-foreground">
                  Manage
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    nav('/lift/custom-exercises')
                  }}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
                >
                  <List className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">My exercises</span>
                </button>
              </Card>
              <button
                onClick={() => setMenuOpen(false)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
