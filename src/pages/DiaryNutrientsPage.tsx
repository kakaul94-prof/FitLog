import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { useDiary } from '@/features/diary/useDiary'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, dateLabel } from '@/lib/date'
import type { Meal } from '@/lib/database.types'

export function DiaryNutrientsPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = params.get('meal') as Meal | null
  const { data: entries } = useDiary(date)
  const scoped = meal
    ? (entries ?? []).filter((e) => e.meal === meal)
    : (entries ?? [])
  const total = sumNutrients(
    scoped.map((e) => scaleNutrients(e.nutrients, e.servings)),
  )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
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
      </div>
    </div>
  )
}
