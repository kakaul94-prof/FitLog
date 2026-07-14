import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import {
  useDiaryEntry,
  useUpdateDiaryEntry,
  useDeleteDiaryEntry,
} from '@/features/diary/useDiary'
import { scaleNutrients } from '@/lib/nutrients'
import type { Meal } from '@/lib/database.types'

export function DiaryEntryPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: entry, isLoading } = useDiaryEntry(id)
  const updateEntry = useUpdateDiaryEntry()
  const del = useDeleteDiaryEntry()
  const [servings, setServings] = useState('1')

  useEffect(() => {
    if (entry) setServings(String(entry.servings))
  }, [entry])

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    )
  }
  if (!entry) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Entry not found.
      </div>
    )
  }

  const s = parseFloat(servings) || 0
  const scaled = scaleNutrients(entry.nutrients, s)

  const saveServings = () => {
    if (s > 0 && s !== entry.servings) {
      updateEntry.mutate({ id: entry.id, servings: s })
    }
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={entry.food_name}
        subtitle={entry.brand ?? undefined}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="srv">Servings</Label>
                <Input
                  id="srv"
                  type="number"
                  inputMode="decimal"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                  onBlur={saveServings}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Meal</Label>
                <Select
                  value={entry.meal}
                  onChange={(e) =>
                    updateEntry.mutate({
                      id: entry.id,
                      meal: e.target.value as Meal,
                    })
                  }
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snacks">Snacks</option>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {servings} × {entry.serving_qty} {entry.serving_unit}
            </p>
          </CardContent>
        </Card>

        <NutrientBreakdown nutrients={scaled} />

        <Button
          variant="outline"
          className="w-full text-destructive"
          onClick={() => {
            if (confirm('Delete this entry?')) {
              del.mutate(entry.id)
              nav(-1)
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> Delete entry
        </Button>
      </div>
    </div>
  )
}
