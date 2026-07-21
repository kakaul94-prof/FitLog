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
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  GripVertical,
  Moon,
  MoreVertical,
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
import { useRoutines } from '@/features/strength/useRoutines'
import { useWorkouts } from '@/features/strength/useStrength'
import { useProgramPlannedVolume } from '@/features/strength/useProgram'
import {
  cycleCounts,
  currentProgramIndex,
  DELOAD_VOLUME_FACTOR,
  deloadActive,
  nextProgramRoutineId,
  programRoutineIds,
  programWorkoutCount,
  upcomingProgramRoutineIds,
} from '@/lib/program'
import type { DeloadState, ProgramItem } from '@/lib/database.types'
import { cn } from '@/lib/utils'

const uid = () => Math.random().toString(36).slice(2)
const round1 = (n: number) => Math.round(n * 10) / 10

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

  const [seq, setSeq] = useState<ProgramItem[]>([])
  const [override, setOverride] = useState<string | null>(null)
  const [deload, setDeload] = useState<DeloadState | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionFor, setActionFor] = useState<{ item: ProgramItem; index: number } | null>(null)
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
  const upcoming = upcomingProgramRoutineIds(seq, history, override, 3)
  const planned = useProgramPlannedVolume(routineIds)
  const isDeload = deloadActive(deload, routineIds, history, counts.lifts)

  const seqRef = useRef(seq)
  seqRef.current = seq
  const overrideRef = useRef(override)
  overrideRef.current = override
  const deloadRef = useRef(deload)
  deloadRef.current = deload

  // --- Persist every edit immediately (settings-style, no Save button) --------
  const commit = (
    nextSeq: ProgramItem[],
    nextOverride: string | null,
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
    const nextOverride = override && ids.includes(override) ? override : null
    commit(next, nextOverride)
    setActionFor(null)
  }
  const setAsNext = (routineId: string) => {
    commit(seq, routineId)
    setActionFor(null)
  }
  const skipNext = () => {
    const ids = programRoutineIds(seq)
    if (nextId && ids.length) {
      const i = ids.indexOf(nextId)
      commit(seq, ids[(i + 1) % ids.length])
    }
    setActionFor(null)
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

  const summaryText =
    currentIdx >= 0 && seq[currentIdx]?.kind === 'routine'
      ? `On day ${currentIdx + 1} of ${counts.length} · ${routineName(
          (seq[currentIdx] as { routineId: string }).routineId,
        )}`
      : nextId
        ? `Not started — first up: ${routineName(nextId)}`
        : 'Add templates to build your rotation'
  const maxSets = planned.data?.bars[0]?.sets ?? 1

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Program"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-5 p-4">
        {/* Cycle summary */}
        {seq.length > 0 && (
          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">
                  {counts.length}-day cycle
                </span>
              </div>
              {counts.lifts > 0 &&
                (isDeload ? (
                  <button
                    onClick={endDeload}
                    className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-800 dark:text-amber-400"
                  >
                    End deload
                  </button>
                ) : (
                  <button
                    onClick={startDeload}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    Start deload
                  </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip>{counts.lifts} lift</Chip>
              {counts.rests > 0 && <Chip muted>{counts.rests} rest</Chip>}
              {isDeload && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Deload
                </span>
              )}
              {planned.data && planned.data.totalSets > 0 && (
                <Chip muted>
                  {isDeload
                    ? Math.round(planned.data.totalSets * DELOAD_VOLUME_FACTOR)
                    : planned.data.totalSets}{' '}
                  sets / cycle
                </Chip>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span className="text-sm text-muted-foreground">{summaryText}</span>
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
                      <Dumbbell className="h-4 w-4 shrink-0 text-muted-foreground" />
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
                    {isCurrent && (
                      <span className="shrink-0 rounded-full border border-primary/50 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Current
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

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Upcoming
              </h2>
              <span className="text-xs text-muted-foreground">next workouts</span>
            </div>
            <Card className="divide-y divide-border overflow-hidden">
              {upcoming.map((rid, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium',
                      i === 0
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">
                    {routineName(rid)}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Planned volume */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Planned volume
            </h2>
            <span className="text-xs text-muted-foreground">sets per cycle</span>
          </div>
          <Card className="space-y-2 p-3">
            {planned.isLoading ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Calculating…
              </p>
            ) : (planned.data?.bars.length ?? 0) === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                Add templates with target sets to see planned volume.
              </p>
            ) : (
              <>
                {isDeload && (
                  <div className="flex items-center gap-1.5 pb-0.5 text-xs text-amber-700 dark:text-amber-400">
                    <TrendingDown className="h-3.5 w-3.5" />
                    <span>
                      Reduced ~{Math.round(DELOAD_VOLUME_FACTOR * 100)}% for your
                      deload
                    </span>
                  </div>
                )}
                {planned.data!.bars.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs">
                      {b.label}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          isDeload ? 'bg-amber-500' : 'bg-primary',
                        )}
                        style={{ width: `${Math.max(6, (b.sets / maxSets) * 100)}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-xs font-medium">
                      {isDeload ? round1(b.sets * DELOAD_VOLUME_FACTOR) : b.sets}
                    </span>
                  </div>
                ))}
                {(planned.data!.needsTarget > 0 || planned.data!.unmapped > 0) && (
                  <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                    {[
                      planned.data!.needsTarget > 0 &&
                        `${planned.data!.needsTarget} need a target`,
                      planned.data!.unmapped > 0 &&
                        `${planned.data!.unmapped} unmapped`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </>
            )}
            <button
              onClick={() => nav('/lift/volume/goals')}
              className="flex w-full items-center justify-end gap-0.5 pt-1 text-xs font-medium text-primary"
            >
              Compare with goals <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Card>
        </div>

        {/* Cardio (placeholder) */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Cardio
          </h2>
          <Card className="flex items-center gap-3 border-dashed p-4">
            <Activity className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Coming soon</div>
              <div className="text-xs text-muted-foreground">
                Schedule cardio into your program.
              </div>
            </div>
          </Card>
        </div>
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
                      <Dumbbell className="h-4 w-4 text-muted-foreground" />
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
