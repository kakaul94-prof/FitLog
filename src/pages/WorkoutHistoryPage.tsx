import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Dumbbell, Flame, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ZoneBadge } from '@/components/ZoneBadge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useWorkouts,
  useWorkoutsRange,
  useDeleteWorkout,
  useUpdateWorkout,
} from '@/features/strength/useStrength'
import { useExerciseEntriesRange } from '@/features/exercise/useExercise'
import { useLongPress } from '@/lib/useLongPress'
import { addDaysISO, dateLabel, todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { ExerciseEntry, Workout } from '@/lib/database.types'

type View = 'list' | 'calendar'
// Per-device convenience only: the page opens on whichever view you used last.
const VIEW_KEY = 'fitlog.historyView'

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'
  } catch {
    return 'list'
  }
}

// History = one page, two views of the same sessions: a month-grouped list
// and the month calendar (which used to be its own Tools → Calendar page).
export function WorkoutHistoryPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [view, setView] = useState<View>(() =>
    params.get('view') === 'calendar' ? 'calendar' : savedView(),
  )
  const del = useDeleteWorkout()
  const updateWorkout = useUpdateWorkout()
  const [actionFor, setActionFor] = useState<Workout | null>(null)
  const [editing, setEditing] = useState<Workout | null>(null)

  const pick = (v: View) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // storage blocked — the toggle still works for this visit
    }
  }

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
      <div className="space-y-4 p-4">
        <div role="tablist" className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
          {(['list', 'calendar'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => pick(v)}
              className={cn(
                'rounded-md py-1.5 font-medium text-muted-foreground',
                view === v && 'bg-card text-foreground shadow-sm',
              )}
            >
              {v === 'list' ? 'List' : 'Calendar'}
            </button>
          ))}
        </div>
        {view === 'list' ? (
          <HistoryList onMenu={setActionFor} />
        ) : (
          <HistoryCalendar onMenu={setActionFor} />
        )}
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

type Item =
  | { kind: 'w'; date: string; w: Workout }
  | { kind: 'c'; date: string; c: ExerciseEntry }

function HistoryList({ onMenu }: { onMenu: (w: Workout) => void }) {
  const nav = useNavigate()
  const today = todayISO()
  const { data: workouts } = useWorkouts()
  // Cardio back to the oldest workout shown (useWorkouts caps at 50), or a
  // year when there are fewer, so both kinds cover the same stretch.
  const capped = workouts != null && workouts.length >= 50
  const since = capped ? workouts[workouts.length - 1].workout_date : addDaysISO(today, -365)
  const { data: cardio } = useExerciseEntriesRange(since, today)

  const groups = useMemo(() => {
    const items: Item[] = [
      ...(workouts ?? []).map((w): Item => ({ kind: 'w', date: w.workout_date, w })),
      ...(cardio ?? []).map((c): Item => ({ kind: 'c', date: c.entry_date, c })),
    ].sort((a, b) => b.date.localeCompare(a.date))
    const thisYear = today.slice(0, 4)
    const out: { key: string; label: string; items: Item[] }[] = []
    for (const it of items) {
      const key = it.date.slice(0, 7)
      if (out[out.length - 1]?.key !== key) {
        out.push({
          key,
          label: new Date(it.date + 'T00:00:00').toLocaleDateString(undefined, {
            month: 'long',
            year: key.startsWith(thisYear) ? undefined : 'numeric',
          }),
          items: [],
        })
      }
      out[out.length - 1].items.push(it)
    }
    return out
  }, [workouts, cardio, today])

  if (!workouts) return null
  return (
    <>
      {groups.length === 0 ? (
        <Card className="p-4 text-center text-sm text-muted-foreground">No workouts yet.</Card>
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">{g.label}</h2>
            <Card className="divide-y divide-border overflow-hidden">
              {g.items.map((it) =>
                it.kind === 'w' ? (
                  <WorkoutRow
                    key={it.w.id}
                    w={it.w}
                    onOpen={() => nav(`/workout/${it.w.id}`)}
                    onMenu={() => onMenu(it.w)}
                  />
                ) : (
                  <CardioRow key={it.c.id} e={it.c} />
                ),
              )}
            </Card>
          </section>
        ))
      )}
      <p className="px-1 text-xs text-muted-foreground">
        Tap to open · press and hold a workout to edit or delete.
        {capped ? ' Showing the last 50 workouts.' : ''}
      </p>
    </>
  )
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function firstOfMonthISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return todayISO(new Date(d.getFullYear(), d.getMonth(), 1))
}
function addMonthsISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  return todayISO(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

function HistoryCalendar({ onMenu }: { onMenu: (w: Workout) => void }) {
  const nav = useNavigate()
  const today = todayISO()
  const [selected, setSelected] = useState(today)
  const [cursor, setCursor] = useState(() => firstOfMonthISO(today))

  const cur = new Date(cursor + 'T00:00:00')
  const year = cur.getFullYear()
  const month = cur.getMonth() // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay() // 0 = Sunday
  const monthStart = cursor
  const monthEnd = todayISO(new Date(year, month, daysInMonth))
  const monthLabel = cur.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const { data: workouts } = useWorkoutsRange(monthStart, monthEnd)
  const { data: cardio } = useExerciseEntriesRange(monthStart, monthEnd)

  const byDate = useMemo(() => {
    const w = new Map<string, Workout[]>()
    for (const x of workouts ?? []) {
      const arr = w.get(x.workout_date) ?? []
      arr.push(x)
      w.set(x.workout_date, arr)
    }
    const c = new Map<string, ExerciseEntry[]>()
    for (const x of cardio ?? []) {
      const arr = c.get(x.entry_date) ?? []
      arr.push(x)
      c.set(x.entry_date, arr)
    }
    return { w, c }
  }, [workouts, cardio])

  const isoFor = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const selWorkouts = byDate.w.get(selected) ?? []
  const selCardio = byDate.c.get(selected) ?? []

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const jumpToDate = (val: string) => {
    if (!val) return
    setSelected(val)
    setCursor(firstOfMonthISO(val))
  }

  return (
    <>
      <input
        type="date"
        value={selected}
        onChange={(e) => jumpToDate(e.target.value)}
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
      />

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor(addMonthsISO(cursor, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">{monthLabel}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCursor(addMonthsISO(cursor, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day == null) return <div key={i} />
            const iso = isoFor(day)
            const hasW = byDate.w.has(iso)
            const hasC = byDate.c.has(iso)
            const isSel = iso === selected
            const isToday = iso === today
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(iso)}
                className={cn(
                  'flex h-11 flex-col items-center justify-center rounded-md text-sm',
                  isSel
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : isToday
                      ? 'ring-1 ring-primary active:bg-accent'
                      : 'active:bg-accent',
                )}
              >
                <span>{day}</span>
                <span className="mt-0.5 flex h-1.5 items-center gap-0.5">
                  {hasW && (
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isSel ? 'bg-primary-foreground' : 'bg-primary',
                      )}
                    />
                  )}
                  {hasC && (
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isSel ? 'bg-primary-foreground' : 'bg-orange-500',
                      )}
                    />
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          {dateLabel(selected)}
        </h2>
        {selWorkouts.length === 0 && selCardio.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">
            Nothing logged on this day.
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {selWorkouts.map((w) => (
              <WorkoutRow
                key={w.id}
                w={w}
                showDate={false}
                onOpen={() => nav(`/workout/${w.id}`)}
                onMenu={() => onMenu(w)}
              />
            ))}
            {selCardio.map((e) => (
              <CardioRow key={e.id} e={e} showDate={false} />
            ))}
          </Card>
        )}
      </div>
    </>
  )
}

// Tap opens the workout; press-and-hold opens the edit / delete menu.
function WorkoutRow({
  w,
  showDate = true,
  onOpen,
  onMenu,
}: {
  w: Workout
  showDate?: boolean
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
        {showDate && (
          <div className="text-xs text-muted-foreground">
            {dateLabel(w.workout_date)}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

// Cardio opens its edit page, which has its own delete.
function CardioRow({ e, showDate = true }: { e: ExerciseEntry; showDate?: boolean }) {
  const meta = [
    showDate ? dateLabel(e.entry_date) : null,
    e.duration_min ? `${e.duration_min} min` : null,
    e.distance_mi ? `${e.distance_mi} mi` : null,
    e.load_lb ? `${e.load_lb} lb` : null,
    e.level ? `L${e.level}/${e.level_max}` : null,
    `${e.calories} calories`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Link
      to={`/exercise/edit/${e.id}`}
      className="flex items-center gap-3 p-3 active:bg-accent"
    >
      <Flame className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{e.name}</div>
        <div className="text-xs text-muted-foreground">{meta}</div>
        <ZoneBadge zone={e.zone} avgHr={e.avg_hr} className="mt-1" />
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
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
