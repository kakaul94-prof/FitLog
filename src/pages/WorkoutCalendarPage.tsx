import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Dumbbell, Flame } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ZoneBadge } from '@/components/ZoneBadge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useWorkoutsRange } from '@/features/strength/useStrength'
import { useExerciseEntriesRange } from '@/features/exercise/useExercise'
import { todayISO, dateLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Workout, ExerciseEntry } from '@/lib/database.types'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function firstOfMonthISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return todayISO(new Date(d.getFullYear(), d.getMonth(), 1))
}
function addMonthsISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  return todayISO(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export function WorkoutCalendarPage() {
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
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Workout history"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
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
                <Link
                  key={w.id}
                  to={`/workout/${w.id}`}
                  className="flex items-center gap-3 p-3 active:bg-accent"
                >
                  <Dumbbell className="h-5 w-5 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">
                    {w.name || 'Workout'}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
              {selCardio.map((e) => {
                const meta = [
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
                    key={e.id}
                    to={`/exercise/edit/${e.id}`}
                    className="flex items-center gap-3 p-3 active:bg-accent"
                  >
                    <Flame className="h-5 w-5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{e.name}</div>
                      <div className="text-xs text-muted-foreground">{meta}</div>
                      <ZoneBadge
                        zone={e.zone}
                        avgHr={e.avg_hr}
                        className="mt-1"
                      />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                )
              })}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
