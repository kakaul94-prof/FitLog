import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Search, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { EXERCISES } from '@/data/exercises'
import { useAddExercise } from '@/features/strength/useStrength'
import {
  useCustomExercises,
  useCreateCustomExercise,
} from '@/features/strength/useCustomExercises'
import type { ExerciseType } from '@/lib/database.types'

export function ExercisePickerPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const supersetWith = params.get('supersetWith') || undefined

  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const add = useAddExercise()
  const { data: custom } = useCustomExercises()
  const createCustom = useCreateCustomExercise()

  const [cname, setCname] = useState('')
  const [cmuscle, setCmuscle] = useState('')
  const [cequip, setCequip] = useState('')
  const [ctype, setCtype] = useState<ExerciseType>('weighted')

  const list = [
    ...(custom ?? []).map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      muscle: c.muscle ?? 'Custom',
      equipment: c.equipment ?? '',
    })),
    ...EXERCISES.map((e) => ({
      key: e.key,
      name: e.name,
      muscle: e.muscle,
      equipment: e.equipment,
    })),
  ]
  const q = search.toLowerCase()
  const filtered = list.filter(
    (e) => e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q),
  )

  const pick = async (key: string, name: string) => {
    await add.mutateAsync({ workoutId: id!, key, name, supersetWithId: supersetWith })
    nav(`/workout/${id}`)
  }

  const saveCustom = async () => {
    if (!cname.trim()) return
    const c = await createCustom.mutateAsync({
      name: cname.trim(),
      muscle: cmuscle.trim() || null,
      equipment: cequip.trim() || null,
      type: ctype,
    })
    await add.mutateAsync({
      workoutId: id!,
      key: `custom:${c.id}`,
      name: c.name,
      supersetWithId: supersetWith,
    })
    nav(`/workout/${id}`)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={supersetWith ? 'Add superset exercise' : 'Add exercise'}
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav(`/workout/${id}`)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            size="icon"
            onClick={() => setAdding((a) => !a)}
            aria-label="New custom exercise"
          >
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {adding && (
          <Card className="space-y-3 p-4">
            <div className="text-sm font-semibold">New custom exercise</div>
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
                onClick={saveCustom}
                disabled={!cname.trim() || createCustom.isPending}
              >
                Add to workout
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search exercises or muscle"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Card className="divide-y divide-border overflow-hidden">
          {filtered.map((e) => (
            <button
              key={e.key}
              onClick={() => pick(e.key, e.name)}
              disabled={add.isPending}
              className="block w-full p-3 text-left active:bg-accent disabled:opacity-50"
            >
              <div className="text-sm font-medium">{e.name}</div>
              <div className="text-xs text-muted-foreground">
                {e.muscle}
                {e.equipment ? ` · ${e.equipment}` : ''}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No matches. Tap + to add a custom exercise.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
