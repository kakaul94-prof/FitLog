import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { RING_OVER } from '@/components/CalorieRing'
import { useDiary } from '@/features/diary/useDiary'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import {
  useMicronutrientTrends,
  type MicroStat,
} from '@/features/insights/useMicronutrientTrends'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, dateLabel } from '@/lib/date'
import type { Meal } from '@/lib/database.types'

export function DiaryNutrientsPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = params.get('meal') as Meal | null
  const { data: entries } = useDiary(date)
  const { dailyMicros, supplements } = useDailySupplements()
  const scoped = meal
    ? (entries ?? []).filter((e) => e.meal === meal)
    : (entries ?? [])
  // Daily supplements (e.g. a multivitamin) count toward the WHOLE-day total on a
  // logged day only — not the per-meal view (they aren't part of a meal), and not
  // an empty day (mirrors the weekly rollup's "logged days").
  const withSupp =
    !meal && (entries ?? []).length > 0 && supplements.length > 0
  const total = sumNutrients([
    ...scoped.map((e) => scaleNutrients(e.nutrients, e.servings)),
    ...(withSupp ? [dailyMicros] : []),
  ])

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={meal ? `${meal[0].toUpperCase() + meal.slice(1)} nutrients` : 'Day nutrients'}
        subtitle={dateLabel(date)}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="p-4">
        {!meal && <WeeklyNudge date={date} />}
        <NutrientBreakdown nutrients={total} />
        {withSupp && (
          <p className="mt-3 text-xs text-muted-foreground">
            Includes your daily{' '}
            {supplements.map((s) => s.food.name).join(', ')} — taken every day,
            not logged to your diary.
          </p>
        )}
      </div>
    </div>
  )
}

// Weekly micronutrient nudge: a plain-language pointer to what you've been
// consistently low/high on over the last 7 logged days. Reuses the Progress →
// Nutrition analysis (useMicronutrientTrends) and folds in a daily supplement.
// A rolling weekly insight, so the caller only mounts it on today's whole-day
// view. Hidden on an on-track week or before anything's logged this week.
function WeeklyNudge({ date }: { date: string }) {
  const nav = useNavigate()
  const { dailyMicros } = useDailySupplements()
  const { data } = useMicronutrientTrends(7, dailyMicros)
  if (date !== todayISO() || !data || data.loggedCount === 0) return null

  const low = data.stats.filter((s) => s.direction === 'floor' && s.flagged)
  // Curated to the two limits worth a daily nudge; Progress shows the rest.
  const over = data.stats.filter(
    (s) => s.flagged && (s.key === 'sodium' || s.key === 'added_sugar'),
  )
  if (low.length === 0 && over.length === 0) return null

  const names = (arr: MicroStat[]) => {
    const shown = arr.slice(0, 3).map((s) => s.label).join(', ')
    return arr.length > 3 ? `${shown} +${arr.length - 3} more` : shown
  }

  return (
    <div className="mb-4 space-y-1.5 rounded-xl border border-border p-3">
      {low.length > 0 && (
        <button
          onClick={() => nav('/progress?view=nutrition')}
          className="block w-full text-center text-xs font-medium text-primary"
        >
          Low this week: {names(low)} →
        </button>
      )}
      {over.length > 0 && (
        <button
          onClick={() => nav('/progress?view=nutrition')}
          className="block w-full text-center text-xs font-medium"
          style={{ color: RING_OVER }}
        >
          Over this week: {names(over)} →
        </button>
      )}
    </div>
  )
}
