import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, X, Link2, Trash2, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EXERCISES } from '@/data/exercises'
import { useCustomExercises } from '@/features/strength/useCustomExercises'
import {
  useRoutine,
  useUpdateRoutine,
  useDeleteRoutine,
  useAddRoutineExercise,
  useUpdateRoutineExercise,
  useRemoveRoutineExercise,
} from '@/features/strength/useRoutines'
import type { RoutineExercise } from '@/lib/database.types'

export function RoutineEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data } = useRoutine(id)
  const routine = data?.routine
  const exercises = data?.exercises ?? []
  const updateRoutine = useUpdateRoutine()
  const delRoutine = useDeleteRoutine()
  const addEx = useAddRoutineExercise()
  const removeEx = useRemoveRoutineExercise()
  const { data: custom } = useCustomExercises()

  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [supersetWith, setSupersetWith] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (routine) setName(routine.name)
  }, [routine])

  const blocks: { group: number | null; exercises: RoutineExercise[] }[] = []
  const seen = new Set<number>()
  for (const ex of exercises) {
    if (ex.superset_group == null) blocks.push({ group: null, exercises: [ex] })
    else if (!seen.has(ex.superset_group)) {
      seen.add(ex.superset_group)
      blocks.push({
        group: ex.superset_group,
        exercises: exercises.filter((e) => e.superset_group === ex.superset_group),
      })
    }
  }

  const openAdd = (ssWith?: string) => {
    setSupersetWith(ssWith)
    setAdding(true)
    setSearch('')
  }
  const pick = async (key: string, exName: string) => {
    await addEx.mutateAsync({ routineId: id!, key, name: exName, supersetWithId: supersetWith })
    setAdding(false)
  }

  const q = search.toLowerCase()
  const allEx = [
    ...(custom ?? []).map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      muscle: c.muscle ?? 'Custom',
    })),
    ...EXERCISES.map((e) => ({ key: e.key, name: e.name, muscle: e.muscle })),
  ]
  const filtered = allEx.filter(
    (e) => e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q),
  )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Edit template"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Template name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name !== routine?.name)
                updateRoutine.mutate({ id: id!, name: name.trim() })
            }}
            placeholder="e.g. Push Day"
          />
        </div>

        {blocks.map((b, bi) =>
          b.group != null ? (
            <div
              key={bi}
              className="space-y-2 rounded-xl border-2 border-primary/30 p-2"
            >
              <div className="px-1 text-xs font-semibold uppercase tracking-wide text-primary">
                Superset
              </div>
              {b.exercises.map((ex, i) => (
                <RoutineExRow
                  key={ex.id}
                  ex={ex}
                  routineId={id!}
                  label={`${i + 1}`}
                  onRemove={() => removeEx.mutate({ id: ex.id, routineId: id! })}
                />
              ))}
            </div>
          ) : (
            <RoutineExRow
              key={b.exercises[0].id}
              ex={b.exercises[0]}
              routineId={id!}
              onRemove={() =>
                removeEx.mutate({ id: b.exercises[0].id, routineId: id! })
              }
              onSuperset={() => openAdd(b.exercises[0].id)}
            />
          ),
        )}

        {adding ? (
          <Card className="p-2">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                autoFocus
                placeholder="Search exercises"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {filtered.map((e) => (
                <button
                  key={e.key}
                  onClick={() => pick(e.key, e.name)}
                  className="block w-full p-2 text-left text-sm active:bg-accent"
                >
                  {e.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    · {e.muscle}
                  </span>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="mt-1 w-full"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </Card>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => openAdd(undefined)}
          >
            <Plus className="h-4 w-4" /> Add exercise
          </Button>
        )}

        <Button
          variant="outline"
          className="w-full text-destructive"
          onClick={() => {
            if (confirm('Delete this template?')) {
              delRoutine.mutate(id!)
              nav('/strength')
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete template
        </Button>
      </div>
    </div>
  )
}

function RoutineExRow({
  ex,
  routineId,
  label,
  onRemove,
  onSuperset,
}: {
  ex: RoutineExercise
  routineId: string
  label?: string
  onRemove: () => void
  onSuperset?: () => void
}) {
  const nav = useNavigate()
  const update = useUpdateRoutineExercise()
  const [sets, setSets] = useState(
    ex.target_sets != null ? String(ex.target_sets) : '',
  )
  const [reps, setReps] = useState(
    ex.target_reps != null ? String(ex.target_reps) : '',
  )
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        {label && (
          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-xs font-bold text-primary">
            {label}
          </span>
        )}
        <button
          className="flex-1 text-left font-medium"
          onClick={() => nav(`/lift/exercise/${ex.exercise_key}`)}
        >
          {ex.exercise_name}
        </button>
        <button
          onClick={onRemove}
          className="text-muted-foreground active:text-destructive"
          aria-label="Remove"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm">
        <Input
          className="h-9 w-16"
          type="number"
          inputMode="numeric"
          placeholder="sets"
          value={sets}
          onChange={(e) => setSets(e.target.value)}
          onBlur={() =>
            update.mutate({
              id: ex.id,
              routineId,
              target_sets: sets ? parseInt(sets) : null,
            })
          }
        />
        <span className="text-muted-foreground">×</span>
        <Input
          className="h-9 w-16"
          type="number"
          inputMode="numeric"
          placeholder="reps"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          onBlur={() =>
            update.mutate({
              id: ex.id,
              routineId,
              target_reps: reps ? parseInt(reps) : null,
            })
          }
        />
        <span className="text-xs text-muted-foreground">target</span>
        {onSuperset && (
          <button
            onClick={onSuperset}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground"
          >
            <Link2 className="h-3.5 w-3.5" /> Superset
          </button>
        )}
      </div>
    </Card>
  )
}
