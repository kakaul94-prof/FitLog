import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Trash2, Flame } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  useExerciseEntries,
  useDeleteExercise,
} from '@/features/exercise/useExercise'
import { todayISO, addDaysISO, dateLabel } from '@/lib/date'

export function ExercisePage() {
  const nav = useNavigate()
  const [date, setDate] = useState(todayISO())
  const { data: entries } = useExerciseEntries(date)
  const del = useDeleteExercise()
  const list = entries ?? []
  const burned = list.reduce((s, e) => s + e.calories, 0)

  return (
    <div>
      <PageHeader
        title="Exercise"
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
        <Card className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
            <Flame className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{burned}</div>
            <div className="text-xs text-muted-foreground">calories burned</div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            {list.map((e) => (
              <div key={e.id} className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.duration_min ? `${e.duration_min} min` : ''}
                    {e.distance_mi ? ` · ${e.distance_mi} mi` : ''} ·{' '}
                    {e.calories} kcal
                  </div>
                </div>
                <button
                  onClick={() => del.mutate(e.id)}
                  className="p-1 text-muted-foreground active:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {list.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No exercise logged.
              </div>
            )}
          </div>
          <button
            onClick={() => nav(`/exercise/add?date=${date}`)}
            className="flex w-full items-center gap-2 p-3 text-sm font-medium text-primary active:bg-accent"
          >
            <Plus className="h-4 w-4" /> Add exercise
          </button>
        </Card>
      </div>
    </div>
  )
}
