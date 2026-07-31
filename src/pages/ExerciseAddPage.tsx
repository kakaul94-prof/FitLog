import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Watch,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import {
  metCalories,
  distanceCalories,
  resolveMaxHr,
  resolveHrZones,
  resolveZoneForHr,
  HR_ZONE_BANDS,
} from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import { useProfile } from '@/features/profile/useProfile'
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
  const { data: profile } = useProfile()
  const log = useLogExercise()
  const update = useUpdateExercise()
  const createCustom = useCreateCustomActivity()
  const updateCustom = useUpdateCustomActivity()
  const deleteCustom = useDeleteCustomActivity()

  // Selected activity (built-in or custom) — met/distanceBased tracked
  // explicitly so custom & free-typed entries keep working on edit.
  // Prefill from the GPS recorder (name/met/dist/dur/kcal in the query string).
  const pf = {
    name: params.get('name'),
    met: params.get('met'),
    dist: params.get('dist'),
    dur: params.get('dur'),
    kcal: params.get('kcal'),
    distanceBased: params.get('distanceBased') === '1',
  }
  // No default activity — a fresh add starts blank and opens the picker.
  const [name, setName] = useState(pf.name ?? '')
  const [met, setMet] = useState(pf.met ? Number(pf.met) : 0)
  const [distanceBased, setDistanceBased] = useState(
    pf.name ? pf.distanceBased : false,
  )
  const [duration, setDuration] = useState(pf.dur ?? '')
  const [distance, setDistance] = useState(pf.dist ?? '')
  const [override, setOverride] = useState(pf.kcal ?? '')
  const [avgHr, setAvgHr] = useState('')
  const [zone, setZone] = useState<number | null>(null)

  // Activity search / custom-create UI
  const [search, setSearch] = useState('')
  const [changing, setChanging] = useState(!editing && !pf.name)
  const [adding, setAdding] = useState(false)
  const [cname, setCname] = useState('')
  const [cmet, setCmet] = useState('5')
  const [cdist, setCdist] = useState(false)
  const [editId, setEditId] = useState<string | null>(null) // editing a custom activity

  // Summary-card UI: which tile's editor is open, kcal-override + rename modes
  const [renaming, setRenaming] = useState(false)
  const [editingKcal, setEditingKcal] = useState(false)
  const [activeTile, setActiveTile] = useState<
    'duration' | 'distance' | 'hr' | null
  >(null)

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
  const maxHr = resolveMaxHr(profile)
  const zones = resolveHrZones(profile)
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
    setAvgHr(entry.avg_hr != null ? String(entry.avg_hr) : '')
    setZone(entry.zone ?? null)
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
    setChanging(false)
    // Straight into duration once an activity is chosen.
    setActiveTile((t) =>
      t == null || (t === 'distance' && !a.distanceBased) ? 'duration' : t,
    )
  }

  const openCreate = () => {
    setEditId(null)
    setCname(search.trim())
    setCmet('5')
    setCdist(false)
    setAdding(true)
  }

  const openEdit = (a: PickActivity, customId: string) => {
    setEditId(customId)
    setCname(a.name)
    setCmet(String(a.met))
    setCdist(a.distanceBased)
    setAdding(true)
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
      avg_hr: avgHr.trim() ? parseInt(avgHr) || null : null,
      zone,
    }
    if (editing && id) await update.mutateAsync({ id, ...payload })
    else await log.mutateAsync(payload)
    nav(-1)
  }

  const pending = log.isPending || update.isPending

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={editing ? 'Edit exercise' : 'Add exercise'}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          !editing && !pf.name ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Record a walk/run with GPS"
              onClick={() => nav('/exercise/track')}
            >
              <MapPin className="h-5 w-5 text-primary" />
            </Button>
          ) : undefined
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
              <div className="flex items-center justify-between gap-2">
                {renaming ? (
                  <Input
                    autoFocus
                    aria-label="Exercise name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setRenaming(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5 text-left"
                    onClick={() => setRenaming(true)}
                  >
                    <span
                      className={cn(
                        'truncate font-semibold',
                        !name && 'text-muted-foreground',
                      )}
                    >
                      {name || 'Choose an activity'}
                    </span>
                    {name && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        · {met} MET
                      </span>
                    )}
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-primary"
                  onClick={() => {
                    setChanging((c) => !c)
                    setAdding(false)
                    setSearch('')
                  }}
                >
                  {changing ? 'Cancel' : 'Change'}
                </Button>
              </div>
              {changing && (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="actsearch"
                    autoFocus
                    className="pl-9"
                    placeholder="Search activities (e.g. mowing)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {!adding && (
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
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-center">
                {editingKcal ? (
                  <div className="flex items-center justify-center gap-1.5">
                    <Input
                      autoFocus
                      type="number"
                      inputMode="numeric"
                      aria-label="Calories"
                      placeholder={String(est)}
                      value={override}
                      onChange={(e) => setOverride(e.target.value)}
                      onBlur={() => setEditingKcal(false)}
                      className="h-11 w-28 text-center text-xl font-bold"
                    />
                    <span className="text-sm text-muted-foreground">cal</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-baseline gap-1.5"
                    onClick={() => setEditingKcal(true)}
                  >
                    <span
                      className={cn(
                        'text-4xl font-bold',
                        calories <= 0 && 'text-muted-foreground',
                      )}
                    >
                      {calories}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      cal
                    </span>
                    <Pencil className="h-3.5 w-3.5 self-center text-muted-foreground" />
                  </button>
                )}
                {override ? (
                  <div className="mt-1 flex items-center justify-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      <Watch className="h-3 w-3" /> Your number
                    </span>
                    <button
                      type="button"
                      className="font-medium text-primary"
                      onClick={() => {
                        setOverride('')
                        setEditingKcal(false)
                      }}
                    >
                      Use auto ({est})
                    </button>
                  </div>
                ) : w != null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editingKcal
                      ? "Enter your watch's number"
                      : 'Auto-estimate · tap to override'}
                  </p>
                ) : null}
                {w == null && (
                  <p className="mt-1 text-xs text-warning">
                    Log your weight in Profile for an estimate.
                  </p>
                )}
              </div>

              <div
                className={cn(
                  'grid gap-2',
                  distanceBased ? 'grid-cols-3' : 'grid-cols-2',
                )}
              >
                {[
                  {
                    key: 'duration' as const,
                    value: dur ? `${dur} min` : null,
                    label: 'Duration',
                  },
                  ...(distanceBased
                    ? [
                        {
                          key: 'distance' as const,
                          value: dist ? `${dist} mi` : null,
                          label: 'Distance',
                        },
                      ]
                    : []),
                  {
                    key: 'hr' as const,
                    value:
                      zone != null && avgHr
                        ? `Z${zone} · ${avgHr}`
                        : zone != null
                          ? `Zone ${zone}`
                          : avgHr
                            ? `${avgHr} bpm`
                            : null,
                    label: 'Heart rate',
                  },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() =>
                      setActiveTile(activeTile === t.key ? null : t.key)
                    }
                    className={cn(
                      'rounded-lg border p-2 text-center transition-colors',
                      activeTile === t.key
                        ? 'border-primary bg-primary/10'
                        : 'border-transparent bg-muted',
                    )}
                  >
                    <div
                      className={cn(
                        'truncate text-sm font-semibold',
                        !t.value && 'text-muted-foreground',
                      )}
                      style={
                        t.key === 'hr' && zone != null
                          ? { color: zoneColor(zone) }
                          : undefined
                      }
                    >
                      {t.value ?? 'Add'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.label}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {activeTile === 'duration' && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="dur">Duration (min)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="dur"
                    type="number"
                    inputMode="numeric"
                    className="w-20 text-center"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                  {[15, 30, 45, 60].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDuration(String(v))}
                      className={cn(
                        'flex-1 rounded-full border py-1.5 text-sm transition-colors',
                        dur === v
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-border',
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {activeTile === 'distance' && distanceBased && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="dist">Distance (mi, optional)</Label>
                <Input
                  id="dist"
                  type="number"
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </CardContent>
            </Card>
          )}

          {activeTile === 'hr' && (

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="avghr">Avg HR (bpm)</Label>
                <Input
                  id="avghr"
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 138"
                  value={avgHr}
                  onChange={(e) => {
                    const v = e.target.value
                    setAvgHr(v)
                    const hr = parseInt(v)
                    if (maxHr != null && hr > 0)
                      setZone(resolveZoneForHr(hr, profile))
                  }}
                />
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {HR_ZONE_BANDS.map((b) => {
                  const sel = zone === b.zone
                  const c = zoneColor(b.zone)
                  return (
                    <button
                      key={b.zone}
                      type="button"
                      onClick={() => setZone(sel ? null : b.zone)}
                      className="rounded-md border py-2 text-sm font-medium transition-colors"
                      style={{
                        color: c,
                        borderColor: sel ? c : 'transparent',
                        background: `color-mix(in srgb, ${c} ${
                          sel ? 16 : 8
                        }%, transparent)`,
                      }}
                    >
                      Z{b.zone}
                    </button>
                  )
                })}
              </div>
              {zone != null ? (
                <p className="text-xs text-muted-foreground">
                  <span
                    className="font-medium"
                    style={{ color: zoneColor(zone) }}
                  >
                    Zone {zone}
                  </span>{' '}
                  {zones
                    ? `· ${zones[zone - 1].loBpm}–${zones[zone - 1].hiBpm} bpm `
                    : `· ${Math.round(
                        HR_ZONE_BANDS[zone - 1].pctLo * 100,
                      )}–${Math.round(
                        HR_ZONE_BANDS[zone - 1].pctHi * 100,
                      )}% max `}
                  · {HR_ZONE_BANDS[zone - 1].name}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {maxHr == null
                    ? 'Set your birth date or max HR in Profile to match a heart rate to a zone.'
                    : 'Enter your average HR, or tap a zone.'}
                </p>
              )}
            </CardContent>
          </Card>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={onSave}
            disabled={pending || !name.trim() || calories <= 0}
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add exercise'}
          </Button>
        </div>
      )}
    </div>
  )
}
