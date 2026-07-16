import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { useDiary } from '@/features/diary/useDiary'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
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
