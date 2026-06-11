import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBlocker, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, X, Link2, Trash2, Search, Save } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { EXERCISES } from '@/data/exercises'
import {
  useCustomExercises,
  useCreateCustomExercise,
} from '@/features/strength/useCustomExercises'
import {
  useRoutine,
  useCreateRoutine,
  useSaveRoutine,
  useDeleteRoutine,
} from '@/features/strength/useRoutines'
import type { ExerciseType } from '@/lib/database.types'

type DraftEx = {
  localId: string
  exercise_key: string
  exercise_name: string
  target_sets: number | null
  target_reps: number | null
  superset_group: number | null
}

const uid = () => Math.random().toString(36).slice(2)
// Stable signature of the editable state, used to detect unsaved changes
// (localId is a render-only key, so it's excluded).
const serialize = (name: string, d: DraftEx[]) =>
  JSON.stringify({
    name: name.trim(),
    ex: d.map((e) => ({
      exercise_key: e.exercise_key,
      exercise_name: e.exercise_name,
      target_sets: e.target_sets,
      target_reps: e.target_reps,
      superset_group: e.superset_group,
    })),
  })

export function RoutineEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  // `/routines/new` defers creating the row until Save, so discarding a brand
  // new template leaves no empty orphan behind.
  const isNew = id === 'new'
  const { data } = useRoutine(isNew ? undefined : id)
  const createRoutine = useCreateRoutine()
  const saveRoutine = useSaveRoutine()
  const delRoutine = useDeleteRoutine()
  const { data: custom } = useCustomExercises()
  const createCustom = useCreateCustomExercise()

  const [name, setName] = useState('')
  const [draft, setDraft] = useState<DraftEx[]>([])
  const [original, setOriginal] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [supersetWith, setSupersetWith] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  // Inline "new custom exercise" form inside the add panel.
  const [creating, setCreating] = useState(false)
  const [cname, setCname] = useState('')
  const [cmuscle, setCmuscle] = useState('')
  const [cequip, setCequip] = useState('')
  const [ctype, setCtype] = useState<ExerciseType>('weighted')
  const loadedRef = useRef(false)
  const leavingRef = useRef(false)

  // Load the template into local draft state once. From here every edit stays
  // local until the user taps Save (or Discard throws them away) — nothing is
  // written on blur the way it used to be.
  useEffect(() => {
    if (loadedRef.current) return
    if (isNew) {
      loadedRef.current = true
      setName('New template')
      setDraft([])
      setOriginal(serialize('New template', []))
    } else if (data?.routine) {
      loadedRef.current = true
      const d: DraftEx[] = data.exercises.map((e) => ({
        localId: uid(),
        exercise_key: e.exercise_key,
        exercise_name: e.exercise_name,
        target_sets: e.target_sets,
        target_reps: e.target_reps,
        superset_group: e.superset_group,
      }))
      setName(data.routine.name)
      setDraft(d)
      setOriginal(serialize(data.routine.name, d))
    }
  }, [isNew, data])

  const dirty = original != null && serialize(name, draft) !== original
  const saving = saveRoutine.isPending || createRoutine.isPending

  // Prompt before leaving with unsaved edits (back arrow / Android gesture).
  // Clean state, an explicit Save/Discard, or staying within the editor all
  // pass straight through.
  const blocker = useBlocker(({ nextLocation }) => {
    if (leavingRef.current || !dirty) return false
    return !nextLocation.pathname.startsWith(`/routines/${id}`)
  })
  const showExit = blocker.state === 'blocked'

  const persist = async () => {
    const clean = name.trim() || 'New template'
    if (isNew) {
      const r = await createRoutine.mutateAsync(clean)
      await saveRoutine.mutateAsync({ id: r.id, name: clean, exercises: draft })
    } else {
      await saveRoutine.mutateAsync({ id: id!, name: clean, exercises: draft })
    }
  }
  const save = async () => {
    await persist()
    leavingRef.current = true
    nav('/strength')
  }
  const saveAndProceed = async () => {
    await persist()
    blocker.proceed?.()
  }
  const discard = () => {
    if (dirty && !confirm('Discard your changes?')) return
    leavingRef.current = true
    nav('/strength')
  }

  // Group into superset blocks (same scheme as the live workout): a block is
  // anchored at the first member of each shared superset_group.
  const blocks: { group: number | null; exercises: DraftEx[] }[] = []
  const seen = new Set<number>()
  for (const ex of draft) {
    if (ex.superset_group == null) blocks.push({ group: null, exercises: [ex] })
    else if (!seen.has(ex.superset_group)) {
      seen.add(ex.superset_group)
      blocks.push({
        group: ex.superset_group,
        exercises: draft.filter((e) => e.superset_group === ex.superset_group),
      })
    }
  }

  const openAdd = (ssWith?: string) => {
    setSupersetWith(ssWith)
    setAdding(true)
    setCreating(false)
    setSearch('')
  }
  const closeAdd = () => {
    setAdding(false)
    setCreating(false)
    setCname('')
    setCmuscle('')
    setCequip('')
    setCtype('weighted')
  }
  const addToDraft = (key: string, exName: string) => {
    setDraft((prev) => {
      let group: number | null = null
      let next = prev
      if (supersetWith) {
        const anchor = prev.find((e) => e.localId === supersetWith)
        if (anchor) {
          if (anchor.superset_group != null) group = anchor.superset_group
          else {
            group =
              prev.reduce((m, e) => Math.max(m, e.superset_group ?? 0), 0) + 1
            next = prev.map((e) =>
              e.localId === anchor.localId ? { ...e, superset_group: group } : e,
            )
          }
        }
      }
      return [
        ...next,
        {
          localId: uid(),
          exercise_key: key,
          exercise_name: exName,
          target_sets: null,
          target_reps: null,
          superset_group: group,
        },
      ]
    })
  }
  const pick = (key: string, exName: string) => {
    addToDraft(key, exName)
    closeAdd()
  }
  // Custom exercises are reusable library items, so the row is created right
  // away (like the live workout's picker) and then dropped into the draft.
  const saveCustom = async () => {
    if (!cname.trim()) return
    const c = await createCustom.mutateAsync({
      name: cname.trim(),
      muscle: cmuscle.trim() || null,
      equipment: cequip.trim() || null,
      type: ctype,
    })
    addToDraft(`custom:${c.id}`, c.name)
    closeAdd()
  }
  const removeEx = (localId: string) =>
    setDraft((prev) => prev.filter((e) => e.localId !== localId))
  const setTarget = (localId: string, patch: Partial<DraftEx>) =>
    setDraft((prev) =>
      prev.map((e) => (e.localId === localId ? { ...e, ...patch } : e)),
    )

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
        title={isNew ? 'New template' : 'Edit template'}
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
                  key={ex.localId}
                  ex={ex}
                  label={`${i + 1}`}
                  onRemove={() => removeEx(ex.localId)}
                  onTarget={(patch) => setTarget(ex.localId, patch)}
                />
              ))}
            </div>
          ) : (
            <RoutineExRow
              key={b.exercises[0].localId}
              ex={b.exercises[0]}
              onRemove={() => removeEx(b.exercises[0].localId)}
              onTarget={(patch) => setTarget(b.exercises[0].localId, patch)}
              onSuperset={() => openAdd(b.exercises[0].localId)}
            />
          ),
        )}

        {adding ? (
          <Card className="p-2">
            {creating ? (
              <div className="space-y-3 p-2">
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
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={saveCustom}
                    disabled={!cname.trim() || createCustom.isPending}
                  >
                    Add to template
                  </Button>
                  <Button variant="ghost" onClick={() => setCreating(false)}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <>
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
                  variant="outline"
                  className="mt-1 w-full"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="h-4 w-4" /> New custom exercise
                </Button>
                <Button
                  variant="ghost"
                  className="mt-1 w-full"
                  onClick={closeAdd}
                >
                  Cancel
                </Button>
              </>
            )}
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

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={discard}
            disabled={saving}
          >
            Discard
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save template'}
          </Button>
        </div>

        {!isNew && (
          <Button
            variant="ghost"
            className="w-full text-destructive"
            onClick={() => {
              if (confirm('Delete this template?')) {
                leavingRef.current = true
                delRoutine.mutate(id!)
                nav('/strength')
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete template
          </Button>
        )}
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
                  Save changes to this template?
                </div>
                <button
                  onClick={saveAndProceed}
                  disabled={saving}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent disabled:opacity-50"
                >
                  <Save className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {saving ? 'Saving…' : 'Save changes'}
                  </span>
                </button>
                <button
                  onClick={() => blocker.proceed?.()}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Discard changes</span>
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
    </div>
  )
}

function RoutineExRow({
  ex,
  label,
  onRemove,
  onSuperset,
  onTarget,
}: {
  ex: DraftEx
  label?: string
  onRemove: () => void
  onSuperset?: () => void
  onTarget: (patch: Partial<DraftEx>) => void
}) {
  const nav = useNavigate()
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
          onBlur={() => onTarget({ target_sets: sets ? parseInt(sets) : null })}
        />
        <span className="text-muted-foreground">×</span>
        <Input
          className="h-9 w-16"
          type="number"
          inputMode="numeric"
          placeholder="reps"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          onBlur={() => onTarget({ target_reps: reps ? parseInt(reps) : null })}
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
