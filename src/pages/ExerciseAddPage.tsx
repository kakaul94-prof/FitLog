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
import { ACTIVITIES, RECORDER_ACTIVITIES } from '@/data/activities'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import {
  useLogExercise,
  useUpdateExercise,
  useExerciseEntry,
  useLastCardioField,
  useRecentExerciseEntries,
} from '@/features/exercise/useExercise'
import type { ExerciseEntry, HrSamples } from '@/lib/database.types'
import {
  useCustomActivities,
  useCreateCustomActivity,
  useUpdateCustomActivity,
  useDeleteCustomActivity,
} from '@/features/exercise/useCustomActivities'
import {
  metCalories,
  distanceCalories,
  cadenceAdjustedMet,
  effectiveWeightLb,
  levelMet,
  resolveMaxHr,
  resolveHrZones,
  resolveZoneForHr,
  HR_ZONE_BANDS,
} from '@/lib/calc'
import { ageFromBirthDate } from '@/lib/calc'
import { hrCalories, hasHrCurve } from '@/lib/hr'
import { clearHrSession, peekHrSession } from '@/lib/hrHandoff'
import { HrCurve } from '@/components/HrCurve'
import { ZoneBars } from '@/components/ZoneBars'
import { zoneColor } from '@/data/zones'
import { useProfile } from '@/features/profile/useProfile'
import { dateLabel, todayISO } from '@/lib/date'

interface PickActivity {
  key: string
  name: string
  met: number
  distanceBased: boolean
  loadable: boolean
  leveled: boolean
  machineDistance: boolean
}

/** Fallback console scale when we've never seen one for this activity. */
const DEFAULT_LEVEL_MAX = 10

/** Quick-pick plate/vest weights, mirroring the duration row's presets. */
const LOAD_PRESETS = [10, 20, 35, 45]

/** Does a prefilled name (GPS recorder, or a cardio item on a workout) belong
 *  to an activity that offers a load? Prefills carry a name, not a key. */
const loadableByName = (n: string): boolean =>
  [...RECORDER_ACTIVITIES, ...ACTIVITIES].some(
    (a) => a.name === n && a.loadable,
  )

/** Same, for the machine resistance-level field. */
const leveledByName = (n: string): boolean =>
  ACTIVITIES.some((a) => a.name === n && a.leveled)

/** Same, for machine-distance (cadence-scaled) activities. */
const machineDistanceByName = (n: string): boolean =>
  ACTIVITIES.some((a) => a.name === n && a.machineDistance)

export function ExerciseAddPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { id } = useParams()
  const editing = !!id
  const { data: weight, isPending: weightPending } = useLatestWeight()
  const { data: entry } = useExerciseEntry(id)
  const { data: custom } = useCustomActivities()
  const { data: recent, isPending: recentPending } = useRecentExerciseEntries()
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
  const [loadable, setLoadable] = useState(
    pf.name ? loadableByName(pf.name) : false,
  )
  const [leveled, setLeveled] = useState(
    pf.name ? leveledByName(pf.name) : false,
  )
  const [machineDistance, setMachineDistance] = useState(
    pf.name ? machineDistanceByName(pf.name) : false,
  )
  const [duration, setDuration] = useState(pf.dur ?? '')
  const [distance, setDistance] = useState(pf.dist ?? '')
  const [load, setLoad] = useState('')
  const [level, setLevel] = useState('')
  const [levelMax, setLevelMax] = useState(String(DEFAULT_LEVEL_MAX))
  const [override, setOverride] = useState(pf.kcal ?? '')
  const [avgHr, setAvgHr] = useState('')
  const [zone, setZone] = useState<number | null>(null)
  // A recorded strap session: the curve, its peak, and real time-in-zone. Null
  // on a hand-logged entry, which keeps the plain avg-HR + zone-chip editor.
  const [hrRec, setHrRec] = useState<{
    samples: HrSamples
    max: number | null
    zoneSeconds: number[]
  } | null>(null)
  // Why the save didn't take. Without this a failed insert just un-presses the
  // button — the entry silently never lands.
  const [saveErr, setSaveErr] = useState<string | null>(null)

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
    'duration' | 'distance' | 'load' | 'level' | 'hr' | null
  >(null)

  const allActivities: PickActivity[] = [
    ...(custom ?? []).map((c) => ({
      key: `custom:${c.id}`,
      name: c.name,
      met: c.met,
      distanceBased: c.distance_based,
      // Custom activities have no loadable flag of their own; a distance-based
      // one is a walk/hike variant, which is where a pack makes sense.
      loadable: c.distance_based,
      // No resistance dial by default — most custom activities are chores or
      // classes, and a stray tile on those is worse than a missing one.
      leveled: false,
      machineDistance: false,
    })),
    ...ACTIVITIES.map((a) => ({
      key: a.key,
      name: a.name,
      met: a.met,
      distanceBased: a.distanceBased,
      loadable: !!a.loadable,
      leveled: !!a.leveled,
      machineDistance: !!a.machineDistance,
    })),
  ]
  const q = search.trim().toLowerCase()
  const filtered = q
    ? allActivities.filter((a) => a.name.toLowerCase().includes(q))
    : allActivities
  // Empty query shows the 5 most recent activities; the full library is behind
  // search only (or up front for a brand-new account with no history yet).
  const showRecents = !q && !recentPending && !!recent?.length

  const w = weight ?? null
  const maxHr = resolveMaxHr(profile)
  const zones = resolveHrZones(profile)
  const dur = parseFloat(duration) || 0
  const dist = parseFloat(distance) || 0
  const loadLb = loadable ? parseFloat(load) || 0 : 0
  // A carried load is extra mass to move, so it feeds both burn formulas.
  const movedLb = effectiveWeightLb(w, loadLb)
  const lvl = leveled ? parseInt(level) || 0 : 0
  const lvlMax = parseInt(levelMax) || 0
  // A resistance level, once set, replaces the activity's generic MET — it says
  // far more about the effort than "elliptical" does. On machine-distance
  // activities a logged distance then scales that MET by measured cadence.
  const levelBasedMet = (leveled ? levelMet(lvl, lvlMax) : null) ?? met
  const effMet = machineDistance
    ? cadenceAdjustedMet(levelBasedMet, dist, dur)
    : levelBasedMet
  const est =
    w == null
      ? 0
      : distanceBased && dist
        ? distanceCalories(dist, movedLb, effMet)
        : metCalories(effMet, dur, movedLb)
  const calories = override ? parseInt(override) || 0 : est
  // Keytel burn from the recorded average — offered, never forced, so nothing
  // silently rewrites the diary's eat-back number.
  const hrKcal = hrCalories(
    parseInt(avgHr) || null,
    dur || null,
    movedLb || null,
    ageFromBirthDate(profile?.birth_date ?? null),
    profile?.sex ?? null,
  )

  const date = entry?.entry_date ?? params.get('date') ?? todayISO()

  // A session just handed over by the recorder (?hr=1). It rides in
  // sessionStorage, not the query string — see lib/hrHandoff.ts.
  const hrPrefilled = useRef(false)
  useEffect(() => {
    if (editing || params.get('hr') !== '1' || hrPrefilled.current) return
    const h = peekHrSession()
    if (!h) return
    hrPrefilled.current = true
    if (h.avg != null) setAvgHr(String(h.avg))
    if (h.zone != null) setZone(h.zone)
    setHrRec({ samples: h.samples, max: h.max, zoneSeconds: h.zoneSeconds })
    setActiveTile('hr')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      setMachineDistance(match.machineDistance)
    } else {
      setMet(entry.met ?? 0)
      setDistanceBased(entry.distance_mi != null)
      setMachineDistance(false)
    }
    // An entry that recorded a load stays loadable even if the activity has
    // since changed, so the saved weight is still visible and editable.
    const ld = match ? match.loadable : entry.load_lb != null
    setLoadable(ld || entry.load_lb != null)
    setLeveled((match ? match.leveled : false) || entry.level != null)
    setLevel(entry.level != null ? String(entry.level) : '')
    if (entry.level_max != null) setLevelMax(String(entry.level_max))
    setName(entry.name)
    setDuration(entry.duration_min != null ? String(entry.duration_min) : '')
    setDistance(entry.distance_mi != null ? String(entry.distance_mi) : '')
    setLoad(entry.load_lb != null ? String(entry.load_lb) : '')
    setAvgHr(entry.avg_hr != null ? String(entry.avg_hr) : '')
    setZone(entry.zone ?? null)
    if (hasHrCurve(entry.hr_samples))
      setHrRec({
        samples: entry.hr_samples!,
        max: entry.max_hr,
        zoneSeconds: entry.zone_seconds ?? [0, 0, 0, 0, 0],
      })
    // Preserve a manual override (e.g. from a watch): if the stored calories
    // don't match the formula estimate, keep them as an override. The load has
    // to be in this estimate too, or every loaded entry reopens mislabelled.
    const di = entry.distance_mi ?? 0
    // A levelled or machine-distance entry snapshotted its resolved MET
    // (level → MET, cadence-scaled), so trust the stored one over the
    // activity's generic value — metCalories on it reproduces the saved kcal.
    const mdb = match ? match.machineDistance : false
    const m =
      entry.level != null || mdb
        ? entry.met ?? 0
        : match
          ? match.met
          : entry.met ?? 0
    const db = match ? match.distanceBased : entry.distance_mi != null
    const mv = effectiveWeightLb(w, entry.load_lb)
    const e0 =
      w == null
        ? 0
        : db && di
          ? distanceCalories(di, mv, m)
          : metCalories(m, entry.duration_min ?? 0, mv)
    if (Math.round(e0) !== Math.round(entry.calories))
      setOverride(String(entry.calories))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, entry, weightPending, custom, w])

  // Prefill the load you used last time for this activity — once per activity,
  // so clearing the field doesn't immediately refill it.
  const { data: lastLoad } = useLastCardioField(
    !editing && loadable && name ? name : null,
    'load_lb',
  )
  const loadPrefilledFor = useRef<string | null>(null)
  useEffect(() => {
    if (editing || !loadable || lastLoad == null) return
    if (loadPrefilledFor.current === name) return
    loadPrefilledFor.current = name
    setLoad(String(lastLoad))
  }, [editing, loadable, lastLoad, name])

  // Same for how many levels the console has — set 18 once and it sticks, but
  // it stays per-entry so a session on the gym's machine is one field to change.
  const { data: lastLevelMax } = useLastCardioField(
    !editing && leveled && name ? name : null,
    'level_max',
  )
  const maxPrefilledFor = useRef<string | null>(null)
  useEffect(() => {
    if (editing || !leveled || lastLevelMax == null) return
    if (maxPrefilledFor.current === name) return
    maxPrefilledFor.current = name
    setLevelMax(String(lastLevelMax))
  }, [editing, leveled, lastLevelMax, name])

  const pickActivity = (a: PickActivity) => {
    setName(a.name)
    setMet(a.met)
    setDistanceBased(a.distanceBased)
    setMachineDistance(a.machineDistance)
    setLoadable(a.loadable)
    if (!a.loadable) setLoad('')
    setLeveled(a.leveled)
    if (!a.leveled) setLevel('')
    setSearch('')
    setChanging(false)
    // Straight into duration once an activity is chosen.
    setActiveTile((t) =>
      t == null ||
      (t === 'distance' && !(a.distanceBased || a.machineDistance)) ||
      (t === 'load' && !a.loadable) ||
      (t === 'level' && !a.leveled)
        ? 'duration'
        : t,
    )
  }

  // Tap a Recent row: select that activity with the whole last session prefilled
  // — tweak anything, then save. Mirrors the editing prefill's flag fallbacks so
  // renamed/deleted activities still open sensibly.
  const pickRecent = (e: ExerciseEntry) => {
    const match = allActivities.find((a) => a.name === e.name)
    setName(e.name)
    // A levelled entry snapshotted its resolved MET — trust it over the generic.
    setMet(
      e.level != null ? e.met ?? 0 : match ? match.met : e.met ?? 0,
    )
    setDistanceBased(match ? match.distanceBased : e.distance_mi != null)
    setMachineDistance(match ? match.machineDistance : false)
    setLoadable((match ? match.loadable : false) || e.load_lb != null)
    setLeveled((match ? match.leveled : false) || e.level != null)
    setDuration(e.duration_min != null ? String(e.duration_min) : '')
    setDistance(e.distance_mi != null ? String(e.distance_mi) : '')
    setLoad(e.load_lb != null ? String(e.load_lb) : '')
    setLevel(e.level != null ? String(e.level) : '')
    if (e.level_max != null) setLevelMax(String(e.level_max))
    setAvgHr(e.avg_hr != null ? String(e.avg_hr) : '')
    setZone(e.zone ?? null)
    // Reusing an old session as a template copies its numbers, never its
    // recorded curve — that trace belongs to the day it was measured.
    setHrRec(null)
    // The last-used prefill effects must not clobber what this session recorded.
    loadPrefilledFor.current = e.name
    maxPrefilledFor.current = e.name
    setSearch('')
    setChanging(false)
    setActiveTile(null)
  }

  // "Log again": save a copy of the last session to the current diary date.
  // Calories are copied verbatim — a watch override was that session's truth.
  const logAgain = async (e: ExerciseEntry) => {
    await log.mutateAsync({
      entry_date: date,
      name: e.name,
      met: e.met,
      duration_min: e.duration_min,
      distance_mi: e.distance_mi,
      load_lb: e.load_lb,
      level: e.level,
      level_max: e.level_max,
      calories: e.calories,
      avg_hr: e.avg_hr,
      zone: e.zone,
      // The old session's trace isn't this session's — only the numbers copy.
      max_hr: null,
      hr_samples: null,
      zone_seconds: null,
    })
    nav(-1)
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
      loadable: next.distance_based,
      leveled: false,
      machineDistance: false,
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
      // Snapshot the MET actually used, so a past entry keeps its numbers if the
      // level→MET mapping is ever retuned.
      met: effMet,
      duration_min: dur || null,
      distance_mi: (distanceBased || machineDistance) && dist ? dist : null,
      load_lb: loadLb || null,
      level: lvl || null,
      level_max: lvl ? lvlMax || null : null,
      calories,
      avg_hr: avgHr.trim() ? parseInt(avgHr) || null : null,
      zone,
      max_hr: hrRec?.max ?? null,
      hr_samples: hrRec?.samples ?? null,
      zone_seconds: hrRec?.zoneSeconds ?? null,
    }
    try {
      setSaveErr(null)
      if (editing && id) await update.mutateAsync({ id, ...payload })
      else await log.mutateAsync(payload)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // A missing column means the app is ahead of the database — say so
      // plainly instead of leaving a Postgres error on screen.
      setSaveErr(
        /does not exist|schema cache/i.test(msg)
          ? `Your database is missing a column this version needs (${msg}). Run the latest migration in Supabase.`
          : `Couldn't save: ${msg}`,
      )
      return
    }
    clearHrSession()
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
              {(!changing || !!name) && (
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
                        · {Math.round(effMet * 10) / 10} MET
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
              )}
              {changing && (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="actsearch"
                    className="pl-9"
                    placeholder="Search activities (e.g. mowing)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                {!adding && showRecents && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-xs text-muted-foreground">Recent</div>
                    <Card className="divide-y divide-border overflow-hidden">
                      {recent!.map((e) => (
                        <div key={e.id} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => pickRecent(e)}
                            className="block min-w-0 flex-1 p-3 text-left active:bg-accent"
                          >
                            <div className="truncate text-sm font-medium">
                              {e.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {[
                                e.distance_mi != null
                                  ? `${e.distance_mi} mi`
                                  : e.duration_min
                                    ? `${e.duration_min} min`
                                    : null,
                                e.zone != null ? `Z${e.zone}` : null,
                                `${e.calories} cal`,
                                dateLabel(e.entry_date),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => logAgain(e)}
                            disabled={log.isPending}
                            className="mr-3 shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary active:bg-primary/20 disabled:opacity-50"
                          >
                            Log again
                          </button>
                        </div>
                      ))}
                    </Card>
                  </div>
                )}

                {!adding &&
                  !showRecents &&
                  (q || !recentPending) &&
                  filtered.length > 0 && (
                    <Card className="divide-y divide-border overflow-hidden">
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
                                {w != null
                                  ? `~${Math.round(
                                      metCalories(a.met, 30, w),
                                    )} cal / 30 min`
                                  : `${a.met} MET`}
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

                {!adding && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="flex items-center gap-2 pt-1 text-sm font-medium text-primary"
                  >
                    <Plus className="h-4 w-4" />
                    {q
                      ? `New custom activity "${search.trim()}"`
                      : 'New custom activity'}
                  </button>
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

          {!changing && (
          <>
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
                      : loadLb
                        ? `Auto-estimate · includes ${loadLb} lb load`
                        : lvl
                          ? `Auto-estimate · level ${lvl} of ${lvlMax}`
                          : 'Auto-estimate · tap to override'}
                  </p>
                ) : null}
                {override && loadLb ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your number stands — the load isn't applied to it.
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
                  // Duration + HR are always there; distance/load/level are
                  // per-activity. 4+ wraps to two columns — a single row of four
                  // is too tight to tap.
                  2 +
                    [
                      distanceBased || machineDistance,
                      loadable,
                      leveled,
                    ].filter(Boolean).length >
                    3
                    ? 'grid-cols-2'
                    : distanceBased || machineDistance || loadable || leveled
                      ? 'grid-cols-3'
                      : 'grid-cols-2',
                )}
              >
                {[
                  {
                    key: 'duration' as const,
                    value: dur ? `${dur} min` : null,
                    label: 'Duration',
                  },
                  ...(distanceBased || machineDistance
                    ? [
                        {
                          key: 'distance' as const,
                          value: dist ? `${dist} mi` : null,
                          label: 'Distance',
                        },
                      ]
                    : []),
                  ...(loadable
                    ? [
                        {
                          key: 'load' as const,
                          value: loadLb ? `${loadLb} lb` : null,
                          label: 'Load',
                        },
                      ]
                    : []),
                  ...(leveled
                    ? [
                        {
                          key: 'level' as const,
                          value: lvl ? `${lvl}/${lvlMax}` : null,
                          label: 'Resistance',
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

          {activeTile === 'distance' && (distanceBased || machineDistance) && (
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
                {machineDistance && (
                  <p className="text-xs text-muted-foreground">
                    The console's distance — a faster pace at the same
                    resistance scales the estimate up.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {activeTile === 'load' && loadable && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="load">Added weight (lb)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="load"
                    type="number"
                    inputMode="decimal"
                    className="w-20 text-center"
                    value={load}
                    onChange={(e) => setLoad(e.target.value)}
                  />
                  {LOAD_PRESETS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() =>
                        setLoad((l) => (parseFloat(l) === v ? '' : String(v)))
                      }
                      className={cn(
                        'flex-1 rounded-full border py-1.5 text-sm transition-colors',
                        loadLb === v
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-border',
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pack, plate, or vest — added to your body weight for the
                  estimate.
                </p>
              </CardContent>
            </Card>
          )}

          {activeTile === 'level' && leveled && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <Label htmlFor="level">Resistance level</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="level"
                    type="number"
                    inputMode="numeric"
                    className="w-20 text-center"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">of</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    aria-label="Levels on this machine"
                    className="w-20 text-center"
                    value={levelMax}
                    onChange={(e) => setLevelMax(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">
                    on this machine
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {lvl && lvlMax > 1
                    ? `${Math.round(
                        (Math.min(1, (lvl - 1) / (lvlMax - 1)) * 100),
                      )}% of max · ${Math.round(effMet * 10) / 10} MET. `
                    : ''}
                  Level scales differ by machine, so the estimate uses your share
                  of max —{' '}
                  {machineDistance && dist && dur
                    ? 'scaled by the pace your distance shows.'
                    : 'assuming you hold the same cadence.'}
                </p>
              </CardContent>
            </Card>
          )}

          {activeTile === 'hr' && (

          <Card>
            <CardContent className="space-y-3 p-4">
              {hrRec && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Avg', value: avgHr || '—', color: undefined },
                      {
                        label: 'Max',
                        value: hrRec.max ?? '—',
                        color: zoneColor(5),
                      },
                      {
                        label: 'Zone',
                        value: zone != null ? `Z${zone}` : '—',
                        color: zone != null ? zoneColor(zone) : undefined,
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-lg bg-muted p-2 text-center"
                      >
                        <div
                          className="text-lg font-semibold tabular-nums"
                          style={s.color ? { color: s.color } : undefined}
                        >
                          {s.value}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  <HrCurve bpm={hrRec.samples.bpm} zones={zones} />

                  {hrRec.zoneSeconds.some((s) => s > 0) && (
                    <ZoneBars
                      data={hrRec.zoneSeconds.map((s, i) => ({
                        zone: i + 1,
                        // A zone you touched for 20 seconds still gets a bar, so
                        // it shouldn't read "0 min" next to one.
                        minutes: s > 0 ? Math.max(1, Math.round(s / 60)) : 0,
                      }))}
                    />
                  )}

                  {hrKcal != null && hrKcal !== calories && (
                    <div className="flex items-center gap-3 rounded-lg bg-primary/10 p-3">
                      <p className="flex-1 text-xs">
                        From your heart rate this is about{' '}
                        <span className="font-semibold">{hrKcal} kcal</span> —
                        usually closer than the {distanceBased ? '' : 'MET '}
                        estimate on a machine.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setOverride(String(hrKcal))}
                      >
                        Use
                      </Button>
                    </div>
                  )}
                </>
              )}
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

          {saveErr && (
            <Card className="border-destructive/40">
              <CardContent className="p-4">
                <p className="text-sm text-destructive">{saveErr}</p>
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
          </>
          )}
        </div>
      )}
    </div>
  )
}
