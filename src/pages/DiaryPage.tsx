import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDiary } from '@/features/diary/useDiary'
import { useExerciseEntries } from '@/features/exercise/useExercise'
import { useProfile } from '@/features/profile/useProfile'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { resolveCalorieGoal, resolveMacroTargets } from '@/lib/calc'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, addDaysISO, dateLabel } from '@/lib/date'
import type { Meal } from '@/lib/database.types'

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

  const list = entries ?? []
  const consumed = sumNutrients(
    list.map((e) => scaleNutrients(e.nutrients, e.servings)),
  )
  const goalRes = profile ? resolveCalorieGoal(profile, weight ?? null) : null
  const goal = goalRes?.goal ?? null
  const consumedKcal = Math.round(consumed.kcal ?? 0)
  const burned = (exEntries ?? []).reduce((s, e) => s + e.calories, 0)
  const eatBack = !!profile?.eat_back_exercise && burned > 0
  const remaining =
    goal != null ? goal - consumedKcal + (eatBack ? burned : 0) : null
  const macros =
    goal != null && profile
      ? resolveMacroTargets(goal, weight ?? null, profile.macro_targets)
      : null

  return (
    <div>
      <PageHeader
        title="Diary"
        subtitle={dateLabel(date)}
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
                  {eatBack && <div>+ {burned} exercise</div>}
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
                      have={Math.round(consumed[k] ?? 0)}
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
                  <button
                    key={e.id}
                    onClick={() => nav(`/diary/entry/${e.id}`)}
                    className="flex w-full items-center gap-2 p-3 text-left active:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {e.food_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {e.servings} × {e.serving_qty} {e.serving_unit} ·{' '}
                        {Math.round((e.nutrients.kcal ?? 0) * e.servings)} kcal
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
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
      </div>
    </div>
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
