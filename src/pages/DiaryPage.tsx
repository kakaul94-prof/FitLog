import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Trash2, Flame, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDiary, useStreak, useDeleteDiaryEntry } from '@/features/diary/useDiary'
import {
  useExerciseEntries,
  useDeleteExercise,
} from '@/features/exercise/useExercise'
import { useProfile } from '@/features/profile/useProfile'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { resolveCalorieGoal, resolveMacroTargets, roundHalf } from '@/lib/calc'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, addDaysISO, dateLabel } from '@/lib/date'
import type { DiaryEntry, Meal } from '@/lib/database.types'

const MEALS: { key: Meal; label: string }[] = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snacks', label: 'Snacks' },
]

export function DiaryPage() {
  const nav = useNavigate()
  const [date, setDate] = useState(todayISO())
  const { data: entries } = useDiary(date)
  const { data: profile } = useProfile()
  const { data: weight } = useLatestWeight()
  const { data: exEntries } = useExerciseEntries(date)
  const { data: streak = 0 } = useStreak()
  const delEx = useDeleteExercise()
  const delEntry = useDeleteDiaryEntry()
  const [menuEntry, setMenuEntry] = useState<DiaryEntry | null>(null)

  const list = entries ?? []
  const consumed = sumNutrients(
    list.map((e) => scaleNutrients(e.nutrients, e.servings)),
  )
  const goalRes = profile ? resolveCalorieGoal(profile, weight ?? null) : null
  const goal = goalRes?.goal ?? null
  const consumedKcal = Math.round(consumed.kcal ?? 0)
  const burned = (exEntries ?? []).reduce((s, e) => s + e.calories, 0)
  const remaining =
    goal != null ? goal - consumedKcal + burned : null
  const macros =
    goal != null && profile
      ? resolveMacroTargets(goal, weight ?? null, profile.macro_targets)
      : null

  return (
    <div>
      <PageHeader
        title="Diary"
        subtitle={
          <span className="flex items-center gap-2">
            {dateLabel(date)}
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                <Flame className="h-3.5 w-3.5" />
                {streak}
              </span>
            )}
          </span>
        }
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDate(addDaysISO(date, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDate(addDaysISO(date, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        <Card className="p-4">
          {goal != null ? (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold">{remaining}</div>
                  <div className="text-xs text-muted-foreground">
                    calories remaining
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{goal} goal</div>
                  <div>− {consumedKcal} food</div>
                  {burned > 0 && <div>+ {burned} exercise</div>}
                </div>
              </div>
              {macros && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {(['protein', 'carb', 'fat'] as const).map((k) => (
                    <MacroBar
                      key={k}
                      label={
                        k === 'carb' ? 'Carbs' : k[0].toUpperCase() + k.slice(1)
                      }
                      have={roundHalf(consumed[k] ?? 0)}
                      target={macros[k].grams}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              <span className="text-2xl font-bold text-foreground">
                {consumedKcal}
              </span>{' '}
              kcal eaten.{' '}
              <button
                className="text-primary underline"
                onClick={() => nav('/profile')}
              >
                Set your goal
              </button>{' '}
              to track calories remaining.
            </div>
          )}
          {list.length > 0 && (
            <button
              onClick={() => nav(`/diary/nutrients?date=${date}`)}
              className="mt-3 w-full text-center text-xs font-medium text-primary"
            >
              View full nutrient breakdown →
            </button>
          )}
        </Card>

        {MEALS.map((m) => {
          const items = list.filter((e) => e.meal === m.key)
          const mealKcal = Math.round(
            items.reduce((s, e) => s + (e.nutrients.kcal ?? 0) * e.servings, 0),
          )
          return (
            <Card key={m.key} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-3">
                <span className="font-semibold">{m.label}</span>
                <span className="text-xs text-muted-foreground">
                  {mealKcal} kcal
                </span>
              </div>
              <div className="divide-y divide-border">
                {items.map((e) => (
                  <FoodEntryRow
                    key={e.id}
                    entry={e}
                    onEdit={() => nav(`/diary/entry/${e.id}`)}
                    onMenu={() => setMenuEntry(e)}
                  />
                ))}
              </div>
              <button
                onClick={() => nav(`/diary/add?date=${date}&meal=${m.key}`)}
                className="flex w-full items-center gap-2 p-3 text-sm font-medium text-primary active:bg-accent"
              >
                <Plus className="h-4 w-4" /> Add food
              </button>
            </Card>
          )
        })}

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="font-semibold">Exercise</span>
            <span className="text-xs text-muted-foreground">{burned} kcal</span>
          </div>
          <div className="divide-y divide-border">
            {(exEntries ?? []).map((e) => (
              <div key={e.id} className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.duration_min ? `${e.duration_min} min` : ''}
                    {e.distance_mi ? ` · ${e.distance_mi} mi` : ''} · {e.calories}{' '}
                    kcal
                  </div>
                </div>
                <button
                  onClick={() => delEx.mutate(e.id)}
                  className="p-1 text-muted-foreground active:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => nav(`/exercise/add?date=${date}`)}
            className="flex w-full items-center gap-2 p-3 text-sm font-medium text-primary active:bg-accent"
          >
            <Plus className="h-4 w-4" /> Add exercise
          </button>
        </Card>
      </div>

      {menuEntry &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setMenuEntry(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
                  {menuEntry.food_name}
                </div>
                <button
                  onClick={() => {
                    nav(`/diary/entry/${menuEntry.id}`)
                    setMenuEntry(null)
                  }}
                  className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Edit entry</span>
                </button>
                <button
                  onClick={() => {
                    delEntry.mutate(menuEntry.id)
                    setMenuEntry(null)
                  }}
                  className="flex w-full items-center gap-3 border-t border-border p-4 text-left text-destructive active:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Delete entry</span>
                </button>
              </Card>
              <button
                onClick={() => setMenuEntry(null)}
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

function FoodEntryRow({
  entry,
  onEdit,
  onMenu,
}: {
  entry: DiaryEntry
  onEdit: () => void
  onMenu: () => void
}) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  return (
    <button
      onPointerDown={(e) => {
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        clear()
        timer.current = window.setTimeout(() => {
          fired.current = true
          onMenu()
        }, 450)
      }}
      onPointerMove={(e) => {
        if (
          start.current &&
          Math.hypot(
            e.clientX - start.current.x,
            e.clientY - start.current.y,
          ) > 10
        )
          clear()
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (fired.current) {
          fired.current = false
          return
        }
        onEdit()
      }}
      className="flex w-full select-none items-center gap-2 p-3 text-left [-webkit-touch-callout:none] active:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.food_name}</div>
        <div className="text-xs text-muted-foreground">
          {entry.servings} × {entry.serving_qty} {entry.serving_unit} ·{' '}
          {Math.round((entry.nutrients.kcal ?? 0) * entry.servings)} kcal
        </div>
      </div>
    </button>
  )
}

function MacroBar({
  label,
  have,
  target,
}: {
  label: string
  have: number
  target: number
}) {
  const pct = target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 0
  return (
    <div className="text-center">
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {have}/{target}g
      </div>
    </div>
  )
}
