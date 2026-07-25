import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  GripVertical,
  Moon,
  MoreVertical,
  Play,
  Plus,
  SkipForward,
  Target,
  Trash2,
  TrendingDown,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useRoutines, useStartFromRoutine } from '@/features/strength/useRoutines'
import { useRoutineMeta, useRoutineCardioMap } from '@/features/strength/useRoutineMeta'
import { useWorkouts } from '@/features/strength/useStrength'
import { useProgramPlannedVolume } from '@/features/strength/useProgram'
import { useWeeklyCardioGoal } from '@/features/exercise/useWeeklyCardioGoal'
import { todayISO, daysBetweenISO } from '@/lib/date'
import { REGION_IDS, REGION_LABEL, resolveGoals } from '@/data/bodyMap'
import {
  cycleCounts,
  currentProgramIndex,
  DELOAD_VOLUME_FACTOR,
  deloadActive,
  latestProgramWorkout,
  nextProgramRoutineId,
  programRoutineIds,
  programWorkoutCount,
} from '@/lib/program'
import type { DeloadState, NextOverride, ProgramItem } from '@/lib/database.types'
import { cn } from '@/lib/utils'

const uid = () => Math.random().toString(36).slice(2)

/** Compact "last done" label so the hero meta line stays on one row:
 *  today / yesterday / weekday within the week, else a short date. */
function lastDoneLabel(iso: string): string {
  const diff = daysBetweenISO(iso, todayISO())
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(
    undefined,
    diff < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' },
  )
}

// The sequence slot to badge as "Next up": the first template slot at/after the
// current day (wrapping) whose routine matches the computed next id.
function nextSequenceIndex(
  seq: ProgramItem[],
  currentIdx: number,
  nextId: string | null,
): number {
  if (nextId == null) return -1
  const n = seq.length
  for (let k = 1; k <= n; k++) {
    const i = (((currentIdx + k) % n) + n) % n
    const it = seq[i]
    if (it.kind === 'routine' && it.routineId === nextId) return i
  }
  return seq.findIndex((it) => it.kind === 'routine' && it.routineId === nextId)
}

export function ProgramPage() {
  const nav = useNavigate()
  const { data: profile } = useProfile()
  const { data: routines } = useRoutines()
  const { data: workouts } = useWorkouts()
  const update = useUpdateProfile()
  const startFrom = useStartFromRoutine()

  const [seq, setSeq] = useState<ProgramItem[]>([])
  const [override, setOverride] = useState<NextOverride | string | null>(null)
  const [deload, setDeload] = useState<DeloadState | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionFor, setActionFor] = useState<{ item: ProgramItem; index: number } | null>(null)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const loadedRef = useRef(false)

  // Seed once: from the saved program, else a starter rotation built from the
  // user's templates (left unpersisted until they make an edit).
  useEffect(() => {
    if (loadedRef.current || !profile) return
    const p = profile.program
    if (p && p.sequence?.length) {
      loadedRef.current = true
      setSeq(p.sequence)
      setOverride(p.nextOverride ?? null)
      setDeload(p.deload ?? null)
    } else if (routines) {
      loadedRef.current = true
      setSeq(routines.map((r) => ({ id: uid(), kind: 'routine', routineId: r.id })))
      setOverride(p?.nextOverride ?? null)
      setDeload(p?.deload ?? null)
    }
  }, [profile, routines])

  const history = useMemo(() => workouts ?? [], [workouts])
  const routineName = useMemo(() => {
    const m = new Map((routines ?? []).map((r) => [r.id, r.name]))
    return (id: string) => m.get(id) ?? 'Workout'
  }, [routines])

  const counts = cycleCounts(seq)
  const currentIdx = currentProgramIndex(seq, history)
  const nextId = nextProgramRoutineId(seq, history, override)
  const nextIdx = nextSequenceIndex(seq, currentIdx, nextId)
  const routineIds = programRoutineIds(seq)
  const planned = useProgramPlannedVolume(routineIds)
  const { data: meta } = useRoutineMeta(nextId ?? undefined)
  const { data: cardioMap } = useRoutineCardioMap()
  // A template that's only cardio items reads as a cardio day in the rotation.
  const isCardioDay = (routineId: string) => {
    const c = cardioMap?.get(routineId)
    return !!c && c.cardio > 0 && c.lifts === 0
  }
  const isDeload = deloadActive(deload, routineIds, history, counts.lifts)
  const goalRows = useMemo(() => {
    const goals = resolveGoals(profile?.volume_targets)
    return REGION_IDS.map((id) => ({ id, label: REGION_LABEL[id], sets: goals[id] }))
      .filter((g) => g.sets > 0)
      .sort((a, b) => b.sets - a.sets)
  }, [profile])
  const totalGoalSets = goalRows.reduce((s, g) => s + g.sets, 0)

  const seqRef = useRef(seq)
  seqRef.current = seq
  const overrideRef = useRef(override)
  overrideRef.current = override
  const deloadRef = useRef(deload)
  deloadRef.current = deload

  // --- Persist every edit immediately (settings-style, no Save button) --------
  const commit = (
    nextSeq: ProgramItem[],
    nextOverride: NextOverride | string | null,
    nextDeload: DeloadState | null = deloadRef.current,
  ) => {
    setSeq(nextSeq)
    setOverride(nextOverride)
    setDeload(nextDeload)
    update.mutate({
      program: { sequence: nextSeq, nextOverride, deload: nextDeload },
    })
  }
  const commitRef = useRef(commit)
  commitRef.current = commit

  const addRoutine = (routineId: string) => {
    commit([...seq, { id: uid(), kind: 'routine', routineId }], override)
    setAdding(false)
  }
  const addRest = () => {
    commit([...seq, { id: uid(), kind: 'rest' }], override)
    setAdding(false)
  }
  const removeItem = (item: ProgramItem) => {
    const next = seq.filter((it) => it.id !== item.id)
    const ids = programRoutineIds(next)
    const ovId = typeof override === 'string' ? override : override?.routineId
    commit(next, ovId && ids.includes(ovId) ? override : null)
    setActionFor(null)
  }
  // Pin carries the current latest program workout's id as its marker; logging
  // any program workout after this consumes the pin (see activeOverrideId).
  const pinNext = (routineId: string): NextOverride => ({
    routineId,
    sinceWorkoutId: latestProgramWorkout(programRoutineIds(seq), history)?.id ?? null,
  })
  const setAsNext = (routineId: string) => {
    commit(seq, pinNext(routineId))
    setActionFor(null)
  }
  const skipNext = () => {
    const ids = programRoutineIds(seq)
    if (nextId && ids.length) {
      const i = ids.indexOf(nextId)
      commit(seq, pinNext(ids[(i + 1) % ids.length]))
    }
    setActionFor(null)
  }
  const startNext = async () => {
    if (!nextId) return
    const id = await startFrom.mutateAsync({
      routineId: nextId,
      name: routineName(nextId),
      date: todayISO(),
    })
    nav(`/workout/${id}`)
  }
  const startDeload = () =>
    commit(seq, override, {
      startProgramWorkouts: programWorkoutCount(routineIds, history),
    })
  const endDeload = () => commit(seq, override, null)

  // --- Long-press drag-to-reorder (ported from RoutineEditPage, flat items) ----
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const dragKeyRef = useRef<string | null>(null)
  const pressRef = useRef<{ key: string; x: number; y: number } | null>(null)
  const timerRef = useRef<number | null>(null)
  const dragRef = useRef<{
    els: HTMLElement[]
    keys: string[]
    tops: number[]
    centers: number[]
    heights: number[]
    d: number
    gap: number
    startPageY: number
    order: string[]
    insert: number
  } | null>(null)
  const dropRef = useRef<{ key: string; fromTop: number } | null>(null)
  const clearTimer = () => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const EASE = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'

  const layout = (clientY: number) => {
    const st = dragRef.current
    if (!st) return
    const delta = clientY + window.scrollY - st.startPageY
    const draggedCenter = st.centers[st.d] + delta
    const ndKeys: string[] = []
    const ndCenters: number[] = []
    for (let i = 0; i < st.keys.length; i++)
      if (i !== st.d) {
        ndKeys.push(st.keys[i])
        ndCenters.push(st.centers[i])
      }
    const H = 16
    let ins = st.insert
    while (ins < ndCenters.length && ndCenters[ins] + H < draggedCenter) ins++
    while (ins > 0 && ndCenters[ins - 1] - H > draggedCenter) ins--
    st.insert = ins
    const order = ndKeys.slice()
    order.splice(ins, 0, st.keys[st.d])
    st.order = order
    const targetTop = new Map<string, number>()
    let y = st.tops[0]
    for (const k of order) {
      targetTop.set(k, y)
      y += st.heights[st.keys.indexOf(k)] + st.gap
    }
    st.els.forEach((el, i) => {
      el.style.transform =
        i === st.d
          ? `translateY(${delta}px) scale(1.03)`
          : `translateY(${targetTop.get(st.keys[i])! - st.tops[i]}px)`
    })
  }

  const startPress = (key: string) => (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pressRef.current = { key, x: e.clientX, y: e.clientY }
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      dragKeyRef.current = key
      setDragKey(key)
      navigator.vibrate?.(30)
    }, 450)
  }
  const movePress = (e: ReactPointerEvent) => {
    if (dragKeyRef.current) return
    const p = pressRef.current
    if (p && (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10))
      clearTimer()
  }
  const endPress = () => {
    clearTimer()
    pressRef.current = null
  }

  useLayoutEffect(() => {
    if (dragKey == null) return
    const cont = containerRef.current
    if (!cont) return
    const els = Array.from(cont.querySelectorAll<HTMLElement>('[data-block]'))
    const keys = els.map((el) => el.dataset.block!)
    const d = keys.indexOf(dragKey)
    if (d < 0) return
    const sY = window.scrollY
    const rects = els.map((el) => el.getBoundingClientRect())
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 8
    dragRef.current = {
      els,
      keys,
      tops: rects.map((r) => r.top + sY),
      centers: rects.map((r) => r.top + sY + r.height / 2),
      heights: rects.map((r) => r.height),
      d,
      gap,
      startPageY: (pressRef.current?.y ?? rects[d].top) + sY,
      order: keys.slice(),
      insert: d,
    }
    els.forEach((el, i) => {
      el.style.willChange = 'transform'
      el.style.transition = i === d ? 'none' : EASE
      el.style.transform =
        i === d ? 'translateY(0px) scale(1.03)' : 'translateY(0px)'
    })
  }, [dragKey])

  useEffect(() => {
    if (dragKey == null) return
    let lastY = pressRef.current?.y ?? window.innerHeight / 2
    let raf = 0
    const autoScroll = () => {
      const EDGE = 70
      const MAX = 8
      const h = window.innerHeight
      let dy = 0
      if (lastY < EDGE) dy = -Math.ceil(((EDGE - lastY) / EDGE) * MAX)
      else if (lastY > h - EDGE) dy = Math.ceil(((lastY - (h - EDGE)) / EDGE) * MAX)
      if (dy !== 0) {
        window.scrollBy(0, dy)
        layout(lastY)
      }
      raf = requestAnimationFrame(autoScroll)
    }
    const onMove = (e: PointerEvent) => {
      lastY = e.clientY
      layout(e.clientY)
    }
    const onUp = () => {
      const st = dragRef.current
      if (st) {
        dropRef.current = {
          key: st.keys[st.d],
          fromTop: st.els[st.d].getBoundingClientRect().top,
        }
        const order = st.order
        const cur = seqRef.current
        const newSeq = order
          .map((id) => cur.find((it) => it.id === id))
          .filter((x): x is ProgramItem => !!x)
        commitRef.current(newSeq, overrideRef.current)
      }
      dragRef.current = null
      dragKeyRef.current = null
      setDragKey(null)
      pressRef.current = null
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
        window.removeEventListener('click', swallow, true)
      }
      window.addEventListener('click', swallow, true)
      setTimeout(() => window.removeEventListener('click', swallow, true), 350)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    raf = requestAnimationFrame(autoScroll)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey])

  useLayoutEffect(() => {
    const drop = dropRef.current
    if (!drop) return
    dropRef.current = null
    const cont = containerRef.current
    if (!cont) return
    const els = Array.from(cont.querySelectorAll<HTMLElement>('[data-block]'))
    els.forEach((el) => {
      el.style.transition = 'none'
      el.style.transform = ''
      el.style.willChange = ''
    })
    const el = els.find((e) => e.dataset.block === drop.key)
    if (!el) return
    const dy = drop.fromTop - el.getBoundingClientRect().top
    if (Math.abs(dy) < 1) return
    el.style.zIndex = '20'
    el.style.transform = `translateY(${dy}px) scale(1.03)`
    requestAnimationFrame(() => {
      el.style.transition = EASE
      el.style.transform = ''
      const done = () => {
        el.style.transition = ''
        el.style.zIndex = ''
        el.removeEventListener('transitionend', done)
      }
      el.addEventListener('transitionend', done, { once: true })
      setTimeout(done, 260)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (dragKeyRef.current != null) e.preventDefault()
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => document.removeEventListener('touchmove', onTouchMove)
  }, [])

  const metaLine = useMemo(() => {
    if (!meta) return ''
    const parts: string[] = []
    if (meta.exerciseCount > 0)
      parts.push(
        `${meta.exerciseCount} exercise${meta.exerciseCount === 1 ? '' : 's'}`,
      )
    if (meta.targetSets > 0) parts.push(`${meta.targetSets} sets`)
    if (meta.cardioCount > 0)
      parts.push(
        meta.cardioMinutes > 0
          ? `${meta.cardioMinutes} min cardio`
          : `${meta.cardioCount} cardio`,
      )
    if (meta.lastDone) parts.push(`last done ${lastDoneLabel(meta.lastDone)}`)
    return parts.join(' · ')
  }, [meta])

  const setsPerCycle =
    planned.data && planned.data.totalSets > 0
      ? isDeload
        ? Math.round(planned.data.totalSets * DELOAD_VOLUME_FACTOR)
        : planned.data.totalSets
      : 0
  const stripLabel = [
    currentIdx >= 0
      ? `Day ${currentIdx + 1} of ${counts.length}`
      : `${counts.length}-day cycle`,
    ...(setsPerCycle > 0 ? [`${setsPerCycle} sets this cycle`] : []),
  ].join(' · ')

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Program"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          counts.lifts > 0 ? (
            isDeload ? (
              <button
                onClick={endDeload}
                className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-800 dark:text-amber-400"
              >
                End deload
              </button>
            ) : (
              <button
                onClick={startDeload}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                Deload
              </button>
            )
          ) : undefined
        }
      />
      <div className="space-y-5 p-4">
        {/* Cycle progress strip */}
        {seq.length > 0 && (
          <div>
            <div className="flex gap-1">
              {seq.map((item, i) => {
                const done = currentIdx >= 0 && i <= currentIdx
                return (
                  <span
                    key={item.id}
                    className={cn(
                      'h-1.5 flex-1 rounded-full',
                      i === nextIdx
                        ? 'bg-primary/30 ring-1 ring-primary'
                        : done
                          ? item.kind === 'rest'
                            ? 'bg-primary/40'
                            : 'bg-primary'
                          : item.kind === 'rest'
                            ? 'bg-muted/70'
                            : 'bg-muted',
                    )}
                  />
                )
              })}
            </div>
            <div className="mt-1.5 px-0.5 text-xs text-muted-foreground">
              {stripLabel}
            </div>
          </div>
        )}

        {/* Next-up hero */}
        {nextId && (
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Next up
            </div>
            <h2 className="mt-0.5 truncate text-2xl font-bold">
              {routineName(nextId)}
            </h2>
            <p className="mt-1 min-h-5 text-sm text-muted-foreground">
              {metaLine}
            </p>
            {!!meta && (meta.topRegions.length > 0 || meta.cardioCount > 0) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {meta.topRegions.map((r) => (
                  <Chip key={r}>{r}</Chip>
                ))}
                {meta.cardioCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                    <Activity className="h-3 w-3" /> Cardio
                  </span>
                )}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1"
                onClick={startNext}
                disabled={startFrom.isPending}
              >
                <Play className="h-4 w-4" />
                {startFrom.isPending ? 'Starting…' : 'Start workout'}
              </Button>
              <Button variant="outline" onClick={skipNext}>
                Skip
              </Button>
            </div>
          </Card>
        )}

        {/* Deload banner */}
        {isDeload && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-sm font-medium">Deload cycle</div>
              <div className="text-xs opacity-90">
                Aim for about {Math.round(DELOAD_VOLUME_FACTOR * 100)}% of your
                usual volume — lighter weight, easy effort. Auto-ends after this
                cycle.
              </div>
            </div>
          </div>
        )}

        {/* Rotation */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Rotation
          </h2>
          <div ref={containerRef} className="space-y-2 empty:hidden">
            {seq.map((item, index) => {
              const dragging = dragKey === item.id
              const isRoutine = item.kind === 'routine'
              const isCurrent = index === currentIdx
              const isNext = index === nextIdx
              return (
                <div
                  key={item.id}
                  data-block={item.id}
                  onPointerDown={startPress(item.id)}
                  onPointerMove={movePress}
                  onPointerUp={endPress}
                  onPointerCancel={endPress}
                  onContextMenu={(e) => e.preventDefault()}
                  className={cn(
                    'relative select-none',
                    dragging && 'z-10 rounded-xl opacity-95 shadow-xl ring-2 ring-primary',
                  )}
                >
                  <Card
                    className={cn(
                      'flex items-center gap-2 p-3',
                      isCurrent && 'bg-primary/5 ring-1 ring-primary/40',
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    {isRoutine ? (
                      isCardioDay(item.routineId) ? (
                        <Activity className="h-4 w-4 shrink-0 text-orange-500" />
                      ) : (
                        <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )
                    ) : (
                      <Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        isRoutine ? 'font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {isRoutine ? routineName(item.routineId) : 'Rest day'}
                    </span>
                    {isRoutine &&
                      !isCardioDay(item.routineId) &&
                      (cardioMap?.get(item.routineId)?.cardio ?? 0) > 0 && (
                        <Activity
                          className="h-3.5 w-3.5 shrink-0 text-orange-500/70"
                          aria-label="Includes cardio"
                        />
                      )}
                    {isCurrent && (
                      <span className="shrink-0 rounded-full border border-primary/50 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Last done
                      </span>
                    )}
                    {isNext && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                        Next up
                      </span>
                    )}
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setActionFor({ item, index })}
                      className="shrink-0 text-muted-foreground"
                      aria-label="Options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </Card>
                </div>
              )
            })}
          </div>
          <Button
            variant="outline"
            className="mt-2 w-full"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" /> Add day
          </Button>
          {seq.length > 0 && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              Press and hold a day to reorder · tap ⋮ to set next, skip, or remove.
            </p>
          )}
        </div>

        {/* Weekly set goals (collapsible) */}
        <div>
          <Card className="overflow-hidden">
            <button
              onClick={() => setVolumeOpen((o) => !o)}
              aria-expanded={volumeOpen}
              className="flex w-full items-center gap-2.5 p-3 text-left"
            >
              <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">Weekly set goals</span>
              {totalGoalSets > 0 && (
                <span className="text-xs text-muted-foreground">
                  {totalGoalSets} sets / week
                </span>
              )}
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  volumeOpen && 'rotate-180',
                )}
              />
            </button>
            {volumeOpen && (
              <div className="border-t border-border p-3 pt-2.5">
                {goalRows.length === 0 ? (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    No weekly set goals yet.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {goalRows.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-sm">{g.label}</span>
                        <span className="text-sm font-medium">{g.sets}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => nav('/lift/volume/goals')}
                  className="flex w-full items-center justify-end gap-0.5 pt-2 text-xs font-medium text-primary"
                >
                  Edit goals <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* Weekly cardio goal — same rollup Progress → Cardio shows, counting
            diary entries and programmed cardio alike */}
        <CardioGoalCard routineIds={routineIds} />
      </div>

      {/* Add-day sheet */}
      {adding &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setAdding(false)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-xs text-muted-foreground">
                  Add a day
                </div>
                <div className="max-h-64 divide-y divide-border overflow-y-auto">
                  {(routines ?? []).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => addRoutine(r.id)}
                      className="flex w-full items-center gap-3 p-3 text-left active:bg-accent"
                    >
                      {isCardioDay(r.id) ? (
                        <Activity className="h-4 w-4 text-orange-500" />
                      ) : (
                        <Dumbbell className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">{r.name}</span>
                    </button>
                  ))}
                  {(routines ?? []).length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No templates yet — create one on the Exercise page.
                    </div>
                  )}
                </div>
                <button
                  onClick={addRest}
                  className="flex w-full items-center gap-3 border-t border-border p-3 text-left active:bg-accent"
                >
                  <Moon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Rest day</span>
                </button>
              </Card>
              <button
                onClick={() => setAdding(false)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Row action sheet */}
      {actionFor &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setActionFor(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
                  {actionFor.item.kind === 'routine'
                    ? routineName(actionFor.item.routineId)
                    : 'Rest day'}
                </div>
                {actionFor.item.kind === 'routine' && (
                  <button
                    onClick={() =>
                      setAsNext((actionFor.item as { routineId: string }).routineId)
                    }
                    className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
                  >
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Set as next</span>
                  </button>
                )}
                {actionFor.index === nextIdx && (
                  <button
                    onClick={skipNext}
                    className="flex w-full items-center gap-3 border-t border-border p-4 text-left active:bg-accent"
                  >
                    <SkipForward className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      Skip — train the next one
                    </span>
                  </button>
                )}
                <button
                  onClick={() => removeItem(actionFor.item)}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Remove from program</span>
                </button>
              </Card>
              <button
                onClick={() => setActionFor(null)}
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

/**
 * Weekly cardio goal, collapsed to a one-line readout. Progress comes from
 * logged `exercise_entries` (diary or programmed workout — both write there),
 * while `routineIds` supplies what the rotation itself programs per cycle, so
 * you can see whether the program covers the goal.
 */
function CardioGoalCard({ routineIds }: { routineIds: string[] }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const { goal, summary } = useWeeklyCardioGoal()
  const { data: cardioMap } = useRoutineCardioMap()

  if (!goal)
    return (
      <button onClick={() => nav('/cardio/goal')} className="block w-full text-left">
        <Card className="flex items-center gap-3 border-dashed p-4">
          <Activity className="h-5 w-5 shrink-0 text-orange-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Set a weekly cardio goal</div>
            <div className="text-xs text-muted-foreground">
              Target minutes per week by intensity — light/heavy or zones 1–5.
              Every cardio entry you log counts toward it.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Card>
      </button>
    )

  const planned = routineIds.reduce(
    (acc, id) => {
      const c = cardioMap?.get(id)
      if (!c) return acc
      return {
        light: acc.light + c.lightMinutes,
        heavy: acc.heavy + c.heavyMinutes,
      }
    },
    { light: 0, heavy: 0 },
  )
  const plannedTotal = Math.round(planned.light + planned.heavy)
  // Normalize the stacked bar so an over-target week still reads full, not clipped.
  const denom = Math.max(summary.totalTarget, summary.totalDone, 1)

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full p-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 shrink-0 text-orange-500" />
          <span className="flex-1 text-sm font-medium">Weekly cardio goal</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {summary.totalDone} / {summary.totalTarget} min
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </div>
        <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
          {summary.buckets.map((b) => (
            <div
              key={b.key}
              style={{ width: `${(b.done / denom) * 100}%`, background: b.color }}
            />
          ))}
        </div>
      </button>
      {open && (
        <div className="border-t border-border p-3 pt-2.5">
          <div className="space-y-2">
            {summary.buckets.map((b) => (
              <div key={b.key}>
                <div className="mb-0.5 flex items-baseline justify-between text-xs">
                  <span>
                    {b.label}{' '}
                    <span className="text-muted-foreground">{b.sublabel}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {b.done}
                    {b.target > 0 ? ` / ${b.target}` : ''} min
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${b.target > 0 ? Math.min(100, (b.done / b.target) * 100) : 0}%`,
                      background: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-xs leading-snug text-muted-foreground">
            {plannedTotal > 0 ? (
              <>
                Your rotation programs {plannedTotal} min of cardio per cycle
                {planned.heavy > 0 &&
                  planned.light > 0 &&
                  ` (${Math.round(planned.light)} light · ${Math.round(planned.heavy)} heavy)`}
                .
              </>
            ) : (
              <>
                No cardio programmed in this rotation yet — add cardio to a
                template and it counts here when you log it.
              </>
            )}
          </p>
          <button
            onClick={() => nav('/cardio/goal')}
            className="flex w-full items-center justify-end gap-0.5 pt-2 text-xs font-medium text-primary"
          >
            Edit goal <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Card>
  )
}

function Chip({
  children,
  muted,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-medium',
        muted ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary',
      )}
    >
      {children}
    </span>
  )
}
