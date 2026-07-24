import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Dumbbell, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useWorkouts,
  useDeleteWorkout,
  useUpdateWorkout,
} from '@/features/strength/useStrength'
import { useLongPress } from '@/lib/useLongPress'
import { dateLabel } from '@/lib/date'
import type { Workout } from '@/lib/database.types'

export function WorkoutHistoryPage() {
  const nav = useNavigate()
  const { data: workouts } = useWorkouts()
  const del = useDeleteWorkout()
  const updateWorkout = useUpdateWorkout()
  const [actionFor, setActionFor] = useState<Workout | null>(null)
  const [editing, setEditing] = useState<Workout | null>(null)

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
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="History"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-2 p-4">
        <Card className="divide-y divide-border overflow-hidden">
          {(workouts ?? []).map((w) => (
            <WorkoutRow
              key={w.id}
              w={w}
              onOpen={() => nav(`/workout/${w.id}`)}
              onMenu={() => setActionFor(w)}
            />
          ))}
          {workouts && workouts.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No workouts yet.
            </div>
          )}
        </Card>
        <p className="px-1 text-xs text-muted-foreground">
          Tap to open · press and hold to edit or delete.
          {workouts && workouts.length >= 50 ? ' Showing the last 50.' : ''}
        </p>
      </div>

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
function WorkoutRow({
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
