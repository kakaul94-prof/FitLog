import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus,
  Dumbbell,
  Play,
  ChevronRight,
  CalendarDays,
  ClipboardList,
  Pencil,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useWorkouts,
  useCreateWorkout,
  useDeleteWorkout,
  useUpdateWorkout,
} from '@/features/strength/useStrength'
import { useRoutines, useStartFromRoutine } from '@/features/strength/useRoutines'
import { useLongPress } from '@/lib/useLongPress'
import { todayISO, dateLabel } from '@/lib/date'
import type { Workout } from '@/lib/database.types'

export function StrengthPage() {
  const nav = useNavigate()
  const { data: workouts } = useWorkouts()
  const { data: routines } = useRoutines()
  const create = useCreateWorkout()
  const startFrom = useStartFromRoutine()
  const del = useDeleteWorkout()
  const updateWorkout = useUpdateWorkout()
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionFor, setActionFor] = useState<Workout | null>(null)
  const [editing, setEditing] = useState<Workout | null>(null)

  const startEmpty = async () => {
    const w = await create.mutateAsync({ workout_date: todayISO(), name: 'Workout' })
    nav(`/workout/${w.id}`)
  }
  const startTemplate = async (rid: string, name: string) => {
    const id = await startFrom.mutateAsync({ routineId: rid, name, date: todayISO() })
    nav(`/workout/${id}`)
  }

  const deleteWorkout = async () => {
    if (!actionFor) return
    if (
      !confirm(
        `Delete "${actionFor.name || 'Workout'}"? This also deletes its exercises and sets.`,
      )
    )
      return
    await del.mutateAsync(actionFor.id)
    setActionFor(null)
  }

  return (
    <div>
      <PageHeader
        title="Exercise"
        action={
          <Button
            size="icon"
            onClick={() => setMenuOpen(true)}
            aria-label="Add"
          >
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-5 p-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Templates
          </h2>
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
                No templates yet. Tap + to add one.
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
              <RecentWorkoutRow
                key={w.id}
                w={w}
                onOpen={() => nav(`/workout/${w.id}`)}
                onMenu={() => setActionFor(w)}
              />
            ))}
            {(workouts ?? []).length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No workouts yet.
              </div>
            )}
          </Card>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Tap to open · press and hold to edit or delete.
          </p>
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
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    nav('/lift/custom-exercises?add=1')
                  }}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left active:bg-accent"
                >
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Custom exercise</span>
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

      {actionFor && (
        <WorkoutActionSheet
          title={`${actionFor.name || 'Workout'} · ${dateLabel(actionFor.workout_date)}`}
          deleting={del.isPending}
          onEdit={() => {
            setEditing(actionFor)
            setActionFor(null)
          }}
          onDelete={deleteWorkout}
          onClose={() => setActionFor(null)}
        />
      )}

      {editing && (
        <EditWorkoutSheet
          workout={editing}
          saving={updateWorkout.isPending}
          onClose={() => setEditing(null)}
          onSave={async (name, date) => {
            await updateWorkout.mutateAsync({
              id: editing.id,
              name: name || null,
              workout_date: date,
            })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// Tap opens the workout; press-and-hold opens the edit / delete menu.
function RecentWorkoutRow({
  w,
  onOpen,
  onMenu,
}: {
  w: Workout
  onOpen: () => void
  onMenu: () => void
}) {
  const press = useLongPress(onMenu, onOpen)
  return (
    <button
      {...press}
      className="flex w-full select-none items-center gap-3 p-3 text-left [-webkit-touch-callout:none] active:bg-accent"
    >
      <Dumbbell className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{w.name || 'Workout'}</div>
        <div className="text-xs text-muted-foreground">
          {dateLabel(w.workout_date)}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function WorkoutActionSheet({
  title,
  deleting,
  onEdit,
  onDelete,
  onClose,
}: {
  title: string
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
            {title}
          </div>
          <button
            onClick={onEdit}
            className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Edit workout</span>
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm font-medium">
              {deleting ? 'Deleting…' : 'Delete workout'}
            </span>
          </button>
        </Card>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}

function EditWorkoutSheet({
  workout,
  saving,
  onClose,
  onSave,
}: {
  workout: Workout
  saving: boolean
  onClose: () => void
  onSave: (name: string, date: string) => void
}) {
  const [name, setName] = useState(workout.name ?? '')
  const [date, setDate] = useState(workout.workout_date)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="space-y-3 p-4">
          <div className="text-sm font-semibold">Edit workout</div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workout"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Date
            </label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={saving || !date}
            onClick={() => onSave(name.trim(), date)}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Card>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
