import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Search, Plus, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACTIVITIES } from '@/data/activities'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import {
  useLogExercise,
  useUpdateExercise,
  useExerciseEntry,
} from '@/features/exercise/useExercise'
import {
  useCustomActivities,
  useCreateCustomActivity,
  useUpdateCustomActivity,
  useDeleteCustomActivity,
} from '@/features/exercise/useCustomActivities'
import { metCalories, distanceCalories } from '@/lib/calc'
import { todayISO } from '@/lib/date'

interface PickActivity {
  key: string
  name: string
  met: number
  distanceBased: boolean
}

export function ExerciseAddPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { id } = useParams()
  const editing = !!id
  const { data: weight, isPending: weightPending } = useLatestWeight()
  const { data: entry } = useExerciseEntry(id)
  const { data: custom } = useCustomActivities()
  const log = useLogExercise()
  const update = useUpdateExercise()
  const createCustom = useCreateCustomActivity()
  const updateCustom = useUpdateCustomActivity()
  const deleteCustom = useDeleteCustomActivity()

  // Selected activity (built-in or custom) — met/distanceBased tracked
  // explicitly so custom & free-typed entries keep working on edit.
  const [name, setName] = useState(ACTIVITIES[0].name)
  const [met, setMet] = useState(ACTIVITIES[0].met)
  const [distanceBased, setDistanceBased] = useState(ACTIVITIES[0].distanceBased)
  const [duration, setDuration] = useState('')
  const [distance, setDistance] = useState('')
  const [override, setOverride] = useState('')

  // Activity search / custom-create UI
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [cname, setCname] = useState('')
  const [cmet, setCmet] = useState('5')
  const [cdist, setCdist] = useState(false)
  const [editId, setEditId] = useState<string | null>(null) // editing a custom activity

  const allActivities: PickActivity[] = [
    ...(custom ?? []).map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      met: c.met,
      distanceBased: c.distance_based,
    })),
    ...ACTIVITIES.map((a) => ({
      key: a.key,
      name: a.name,
      met: a.met,
      distanceBased: a.distanceBased,
    })),
  ]
  const q = search.trim().toLowerCase()
  const filtered = q
    ? allActivities.filter((a) => a.name.toLowerCase().includes(q))
    : allActivities

  const w = weight ?? null
  const dur = parseFloat(duration) || 0
  const dist = parseFloat(distance) || 0
  const est =
    w == null
      ? 0
      : distanceBased && dist
        ? distanceCalories(dist, w, met)
        : metCalories(met, dur, w)
  const calories = override ? parseInt(override) || 0 : est

  const date = entry?.entry_date ?? params.get('date') ?? todayISO()

  // Prefill once when editing (after weight + custom activities have settled so
  // the name match and override-detection below are reliable).
  const initialized = useRef(false)
  useEffect(() => {
    if (
      !editing ||
      !entry ||
      weightPending ||
      custom === undefined ||
      initialized.current
    )
      return
    initialized.current = true
    const match = allActivities.find((a) => a.name === entry.name)
    if (match) {
      setMet(match.met)
      setDistanceBased(match.distanceBased)
    } else {
      setMet(entry.met ?? 0)
      setDistanceBased(entry.distance_mi != null)
    }
    setName(entry.name)
    setDuration(entry.duration_min != null ? String(entry.duration_min) : '')
    setDistance(entry.distance_mi != null ? String(entry.distance_mi) : '')
    // Preserve a manual override (e.g. from a watch): if the stored calories
    // don't match the formula estimate, keep them as an override.
    const di = entry.distance_mi ?? 0
    const m = match ? match.met : entry.met ?? 0
    const db = match ? match.distanceBased : entry.distance_mi != null
    const e0 =
      w == null
        ? 0
        : db && di
          ? distanceCalories(di, w, m)
          : metCalories(m, entry.duration_min ?? 0, w)
    if (Math.round(e0) !== Math.round(entry.calories))
      setOverride(String(entry.calories))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, entry, weightPending, custom, w])

  const pickActivity = (a: PickActivity) => {
    setName(a.name)
    setMet(a.met)
    setDistanceBased(a.distanceBased)
    setSearch('')
    setPicking(false)
  }

  const openCreate = () => {
    setEditId(null)
    setCname(search.trim())
    setCmet('5')
    setCdist(false)
    setAdding(true)
    setPicking(false)
  }

  const openEdit = (a: PickActivity, customId: string) => {
    setEditId(customId)
    setCname(a.name)
    setCmet(String(a.met))
    setCdist(a.distanceBased)
    setAdding(true)
    setPicking(false)
  }

  const closeForm = () => {
    setAdding(false)
    setEditId(null)
  }

  const saveCustom = async () => {
    if (!cname.trim()) return
    const next = {
      name: cname.trim(),
      met: parseFloat(cmet) || 5,
      distance_based: cdist,
    }
    let customId: string
    if (editId) {
      await updateCustom.mutateAsync({ id: editId, ...next })
      customId = editId
    } else {
      customId = (await createCustom.mutateAsync(next)).id
    }
    pickActivity({
      key: `custom:${customId}`,
      name: next.name,
      met: next.met,
      distanceBased: next.distance_based,
    })
    closeForm()
  }

  const removeCustom = async (a: PickActivity, customId: string) => {
    if (!confirm(`Delete "${a.name}"?`)) return
    await deleteCustom.mutateAsync(customId)
    if (editId === customId) closeForm()
  }

  const onSave = async () => {
    const payload = {
      entry_date: date,
      name: name.trim() || 'Exercise',
      met,
      duration_min: dur || null,
      distance_mi: distanceBased && dist ? dist : null,
      calories,
    }
    if (editing && id) await update.mutateAsync({ id, ...payload })
    else await log.mutateAsync(payload)
    nav(-1)
  }

  const pending = log.isPending || update.isPending

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title={editing ? 'Edit exercise' : 'Add exercise'}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      {editing && !entry ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="actsearch">Activity</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="actsearch"
                    className="pl-9"
                    placeholder="Search activities (e.g. mowing)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setPicking(true)}
                    onBlur={() => setTimeout(() => setPicking(false), 150)}
                  />
                </div>

                {(picking || q) && !adding && (
                  <Card className="max-h-60 divide-y divide-border overflow-y-auto">
                    <button
                      type="button"
                      onClick={openCreate}
                      className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium text-primary active:bg-accent"
                    >
                      <Plus className="h-4 w-4" />
                      {q
                        ? `New custom activity "${search.trim()}"`
                        : 'New custom activity'}
                    </button>
                    {filtered.map((a) => {
                      const customId = a.key.startsWith('custom:')
                        ? a.key.slice('custom:'.length)
                        : null
                      return (
                        <div key={a.key} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => pickActivity(a)}
                            className="block min-w-0 flex-1 p-3 text-left active:bg-accent"
                          >
                            <div className="text-sm font-medium">{a.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {a.met} MET
                              {a.distanceBased ? ' · distance' : ''}
                              {customId ? ' · custom' : ''}
                            </div>
                          </button>
                          {customId && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(a, customId)}
                                className="shrink-0 p-3 text-muted-foreground active:text-primary"
                                aria-label={`Edit ${a.name}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeCustom(a, customId)}
                                className="shrink-0 p-3 text-muted-foreground active:text-destructive"
                                aria-label={`Delete ${a.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </Card>
                )}

                {adding && (
                  <Card className="space-y-3 p-4">
                    <div className="text-sm font-semibold">
                      {editId ? 'Edit custom activity' : 'New custom activity'}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cname">Name</Label>
                      <Input
                        id="cname"
                        autoFocus
                        value={cname}
                        onChange={(e) => setCname(e.target.value)}
                        placeholder="e.g. Rucking"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cmet">Intensity (MET)</Label>
                      <Input
                        id="cmet"
                        type="number"
                        inputMode="decimal"
                        value={cmet}
                        onChange={(e) => setCmet(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Effort vs. rest. Light chores ≈ 3, brisk yard work ≈ 5,
                        vigorous ≈ 8+.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={cdist}
                        onChange={(e) => setCdist(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Track distance (miles)
                    </label>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={saveCustom}
                        disabled={
                          !cname.trim() ||
                          createCustom.isPending ||
                          updateCustom.isPending
                        }
                      >
                        {createCustom.isPending || updateCustom.isPending
                          ? 'Saving…'
                          : editId
                            ? 'Save changes'
                            : 'Add activity'}
                      </Button>
                      <Button variant="ghost" onClick={closeForm}>
                        Cancel
                      </Button>
                    </div>
                  </Card>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="exname">Name</Label>
                <Input
                  id="exname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dur">Duration (min)</Label>
                <Input
                  id="dur"
                  type="number"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
              {distanceBased && (
                <div className="space-y-1.5">
                  <Label htmlFor="dist">Distance (mi, optional)</Label>
                  <Input
                    id="dist"
                    type="number"
                    inputMode="decimal"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Estimated burn
                  <div className="text-xs">
                    {name || 'Activity'} · {met} MET
                  </div>
                </div>
                <span className="text-2xl font-bold">
                  {calories}{' '}
                  <span className="text-sm font-medium text-muted-foreground">
                    calories
                  </span>
                </span>
              </div>
              {w == null && (
                <p className="text-xs text-warning">
                  Log your weight in Profile for an estimate.
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ov">
                  Override (optional — from your watch)
                </Label>
                <Input
                  id="ov"
                  type="number"
                  inputMode="numeric"
                  placeholder={String(est)}
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full"
            size="lg"
            onClick={onSave}
            disabled={pending || calories <= 0}
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add exercise'}
          </Button>
        </div>
      )}
    </div>
  )
}
