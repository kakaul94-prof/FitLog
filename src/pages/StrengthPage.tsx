import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Dumbbell,
  Play,
  Pencil,
  CalendarDays,
  PersonStanding,
  ClipboardList,
  List,
  Target,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useWorkouts, useCreateWorkout } from '@/features/strength/useStrength'
import { useRoutines, useStartFromRoutine } from '@/features/strength/useRoutines'
import { useRoutineMeta } from '@/features/strength/useRoutineMeta'
import { useProfile } from '@/features/profile/useProfile'
import { nextRoutineId } from '@/lib/progression'
import { nextProgramRoutineId } from '@/lib/program'
import { todayISO, daysBetweenISO } from '@/lib/date'

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

export function StrengthPage() {
  const nav = useNavigate()
  const { data: workouts } = useWorkouts()
  const { data: routines } = useRoutines()
  const { data: profile } = useProfile()
  const create = useCreateWorkout()
  const startFrom = useStartFromRoutine()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)

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
    const w = await create.mutateAsync({ workout_date: todayISO(), name: 'Workout' })
    nav(`/workout/${w.id}`)
  }
  const startNext = async () => {
    if (!nextRoutine) return
    const id = await startFrom.mutateAsync({
      routineId: nextRoutine.id,
      name: nextRoutine.name,
      date: todayISO(),
    })
    nav(`/workout/${id}`)
  }

  return (
    <div className="flex min-h-[calc(100svh-4.25rem-env(safe-area-inset-bottom))] flex-col">
      <PageHeader
        title="Exercise"
        action={
          <Button size="icon" onClick={() => setMenuOpen(true)} aria-label="Add">
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="flex flex-1 flex-col px-4 pb-2">
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          {routines === undefined ? null : nextRoutine ? (
            <>
              <button
                type="button"
                onClick={() => nav('/program')}
                aria-label="Edit program"
                className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary"
              >
                Next up
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <h2 className="max-w-full truncate px-2 text-3xl font-bold">
                {nextRoutine.name}
              </h2>
              <p className="mt-2 min-h-5 text-sm text-muted-foreground">
                {metaLine}
              </p>
              <Button
                size="lg"
                className="mt-8 w-full max-w-xs"
                onClick={startNext}
                disabled={startFrom.isPending}
              >
                <Play className="h-4 w-4" />
                {startFrom.isPending ? 'Starting…' : 'Start workout'}
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold">No rotation yet</h2>
              <p className="mt-2 max-w-[16rem] text-sm text-muted-foreground">
                Create a workout template and your next session will queue up
                here.
              </p>
              <Button
                size="lg"
                className="mt-8 w-full max-w-xs"
                onClick={() => nav('/routines/new')}
              >
                <ClipboardList className="h-4 w-4" /> New template
              </Button>
              <Button
                variant="ghost"
                className="mt-3 text-primary"
                onClick={startEmpty}
                disabled={create.isPending}
              >
                <Dumbbell className="h-4 w-4" />
                {create.isPending ? 'Starting…' : 'Start empty workout'}
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-8 pb-3">
          <button
            type="button"
            onClick={() => nav('/lift/templates')}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
          >
            Templates
          </button>
          <button
            type="button"
            onClick={() => nav('/lift/history')}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
          >
            Tools
          </button>
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
                  disabled={create.isPending}
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

      {toolsOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setToolsOpen(false)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-xs text-muted-foreground">
                  Tools
                </div>
                <button
                  onClick={() => {
                    setToolsOpen(false)
                    nav('/lift/goals')
                  }}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
                >
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Goals</span>
                </button>
                <button
                  onClick={() => {
                    setToolsOpen(false)
                    nav('/lift/volume')
                  }}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left active:bg-accent"
                >
                  <PersonStanding className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Muscle map</span>
                </button>
                <button
                  onClick={() => {
                    setToolsOpen(false)
                    nav('/lift/calendar')
                  }}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left active:bg-accent"
                >
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Calendar</span>
                </button>
              </Card>
              <button
                onClick={() => setToolsOpen(false)}
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
