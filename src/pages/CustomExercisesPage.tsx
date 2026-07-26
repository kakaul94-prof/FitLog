import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  useCustomExercises,
  useCustomExerciseUsage,
  useCreateCustomExercise,
  useUpdateCustomExercise,
  useDeleteCustomExercise,
} from '@/features/strength/useCustomExercises'
import type { CustomExercise, ExerciseType } from '@/lib/database.types'

type SortMode = 'recent' | 'alpha' | 'used'

export function CustomExercisesPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { data: custom } = useCustomExercises()
  const { data: usage } = useCustomExerciseUsage()
  const createC = useCreateCustomExercise()
  const updateC = useUpdateCustomExercise()
  const deleteC = useDeleteCustomExercise()

  // `?add=1` (from the Exercise-tab + menu) opens straight into the new form.
  const [editing, setEditing] = useState<string | null>(
    params.get('add') === '1' ? 'new' : null,
  )
  const [cname, setCname] = useState('')
  const [cmuscle, setCmuscle] = useState('')
  const [cequip, setCequip] = useState('')
  const [ctype, setCtype] = useState<ExerciseType>('weighted')
  const [sort, setSort] = useState<SortMode>('recent')

  const openNew = () => {
    setCname('')
    setCmuscle('')
    setCequip('')
    setCtype('weighted')
    setEditing('new')
  }
  const openEdit = (c: CustomExercise) => {
    setCname(c.name)
    setCmuscle(c.muscle ?? '')
    setCequip(c.equipment ?? '')
    setCtype(c.type)
    setEditing(c.id)
  }

  const saving = createC.isPending || updateC.isPending
  const save = async () => {
    if (!cname.trim()) return
    const payload = {
      name: cname.trim(),
      muscle: cmuscle.trim() || null,
      equipment: cequip.trim() || null,
      type: ctype,
    }
    if (editing === 'new') await createC.mutateAsync(payload)
    else if (editing) await updateC.mutateAsync({ id: editing, ...payload })
    setEditing(null)
  }
  const remove = (c: CustomExercise) => {
    if (confirm(`Delete "${c.name}"? Past workouts keep their history.`))
      deleteC.mutate(c.id)
  }

  const list = useMemo(() => {
    const arr = [...(custom ?? [])]
    if (sort === 'alpha') {
      arr.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === 'recent') {
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at))
    } else {
      arr.sort(
        (a, b) =>
          (usage?.get(b.id) ?? 0) - (usage?.get(a.id) ?? 0) ||
          a.name.localeCompare(b.name),
      )
    }
    return arr
  }, [custom, sort, usage])

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Custom exercises"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button size="icon" onClick={openNew} aria-label="New custom exercise">
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {editing != null && (
          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">
              {editing === 'new' ? 'New custom exercise' : 'Edit custom exercise'}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cname">Name</Label>
              <Input
                id="cname"
                autoFocus
                value={cname}
                onChange={(e) => setCname(e.target.value)}
                placeholder="e.g. Preacher Curl"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="cmuscle">Muscle</Label>
                <Input
                  id="cmuscle"
                  value={cmuscle}
                  onChange={(e) => setCmuscle(e.target.value)}
                  placeholder="Biceps"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="cequip">Equipment</Label>
                <Input
                  id="cequip"
                  value={cequip}
                  onChange={(e) => setCequip(e.target.value)}
                  placeholder="Barbell"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={ctype}
                onChange={(e) => setCtype(e.target.value as ExerciseType)}
              >
                <option value="weighted">Weighted</option>
                <option value="bodyweight">Bodyweight</option>
                <option value="timed">Timed</option>
                <option value="mobility">Mobility</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={save}
                disabled={!cname.trim() || saving}
              >
                {editing === 'new' ? 'Add exercise' : 'Save changes'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {list.length > 0 && (
          <div className="flex items-center justify-end gap-2">
            <Label htmlFor="sort" className="text-xs text-muted-foreground">
              Sort
            </Label>
            <Select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="h-9 w-auto text-sm"
            >
              <option value="recent">Recently added</option>
              <option value="alpha">A–Z</option>
              <option value="used">Most used</option>
            </Select>
          </div>
        )}

        <Card className="divide-y divide-border overflow-hidden">
          {list.map((c) => (
            <div key={c.id} className="flex items-center gap-2 p-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => nav(`/lift/exercise/custom:${c.id}`)}
              >
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.muscle || 'Custom'}
                  {c.equipment ? ` · ${c.equipment}` : ''}
                </div>
              </button>
              <button
                onClick={() => openEdit(c)}
                className="p-1 text-muted-foreground active:text-foreground"
                aria-label={`Edit ${c.name}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => remove(c)}
                className="p-1 text-muted-foreground active:text-destructive"
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {list.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No custom exercises yet. Tap + to add one.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
