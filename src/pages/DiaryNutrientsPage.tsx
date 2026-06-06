import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { useDiary } from '@/features/diary/useDiary'
import { scaleNutrients, sumNutrients } from '@/lib/nutrients'
import { todayISO, dateLabel } from '@/lib/date'

export function DiaryNutrientsPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const { data: entries } = useDiary(date)
  const total = sumNutrients(
    (entries ?? []).map((e) => scaleNutrients(e.nutrients, e.servings)),
  )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Day nutrients"
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
