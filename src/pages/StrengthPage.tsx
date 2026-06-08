import { Link, useNavigate } from 'react-router-dom'
import { Plus, Dumbbell, Play, ChevronRight, CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useWorkouts, useCreateWorkout } from '@/features/strength/useStrength'
import {
  useRoutines,
  useCreateRoutine,
  useStartFromRoutine,
} from '@/features/strength/useRoutines'
import { todayISO, dateLabel } from '@/lib/date'

export function StrengthPage() {
  const nav = useNavigate()
  const { data: workouts } = useWorkouts()
  const { data: routines } = useRoutines()
  const create = useCreateWorkout()
  const createRoutine = useCreateRoutine()
  const startFrom = useStartFromRoutine()

  const startEmpty = async () => {
    const w = await create.mutateAsync({ workout_date: todayISO(), name: 'Workout' })
    nav(`/workout/${w.id}`)
  }
  const newTemplate = async () => {
    const r = await createRoutine.mutateAsync('New template')
    nav(`/routines/${r.id}`)
  }
  const startTemplate = async (rid: string, name: string) => {
    const id = await startFrom.mutateAsync({ routineId: rid, name, date: todayISO() })
    nav(`/workout/${id}`)
  }

  return (
    <div>
      <PageHeader title="Lift" />
      <div className="space-y-5 p-4">
        <Button
          className="w-full"
          size="lg"
          onClick={startEmpty}
          disabled={create.isPending}
        >
          <Plus className="h-5 w-5" /> Start empty workout
        </Button>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Templates
            </h2>
            <button
              onClick={newTemplate}
              className="text-sm font-medium text-primary"
            >
              + New
            </button>
          </div>
          <Card className="divide-y divide-border overflow-hidden">
            {(routines ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-2 p-3">
                <Link to={`/routines/${r.id}`} className="flex-1">
                  <span className="text-sm font-medium">{r.name}</span>
                </Link>
                <Button
                  size="sm"
                  onClick={() => startTemplate(r.id, r.name)}
                  disabled={startFrom.isPending}
                >
                  <Play className="h-3.5 w-3.5" /> Start
                </Button>
              </div>
            ))}
            {(routines ?? []).length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No templates yet. Tap “+ New”.
              </div>
            )}
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Recent workouts
            </h2>
            <Link
              to="/lift/calendar"
              className="flex items-center gap-1 text-sm font-medium text-primary"
            >
              <CalendarDays className="h-4 w-4" /> Calendar
            </Link>
          </div>
          <Card className="divide-y divide-border overflow-hidden">
            {(workouts ?? []).slice(0, 5).map((w) => (
              <Link
                key={w.id}
                to={`/workout/${w.id}`}
                className="flex items-center gap-3 p-3 active:bg-accent"
              >
                <Dumbbell className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{w.name || 'Workout'}</div>
                  <div className="text-xs text-muted-foreground">
                    {dateLabel(w.workout_date)}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
            {(workouts ?? []).length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No workouts yet.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
