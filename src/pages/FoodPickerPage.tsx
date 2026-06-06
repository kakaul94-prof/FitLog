import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Search, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFoods } from '@/features/foods/useFoods'
import { useLogFood } from '@/features/diary/useDiary'
import { scaleNutrients } from '@/lib/nutrients'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Food, Meal } from '@/lib/database.types'

export function FoodPickerPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = (params.get('meal') || 'breakfast') as Meal
  const [search, setSearch] = useState('')
  const { data: foods } = useFoods(search)
  const [selected, setSelected] = useState<Food | null>(null)
  const [servings, setServings] = useState('1')
  const log = useLogFood()

  const add = async () => {
    if (!selected) return
    await log.mutateAsync({
      entry_date: date,
      meal,
      food: selected,
      servings: parseFloat(servings) || 1,
    })
    nav('/')
  }

  const preview = selected
    ? scaleNutrients(selected.nutrients, parseFloat(servings) || 0)
    : null

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title={`Add to ${meal}`}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4 pb-44">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search your foods"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => nav('/foods/new')}
        >
          <Plus className="h-4 w-4" /> Add a new food
        </Button>
        <Card className="divide-y divide-border overflow-hidden">
          {(foods ?? []).map((f) => (
            <button
              key={f.id}
              onClick={() => setSelected(f)}
              className={cn(
                'block w-full p-3 text-left active:bg-accent',
                selected?.id === f.id && 'bg-accent',
              )}
            >
              <div className="text-sm font-medium">{f.name}</div>
              <div className="text-xs text-muted-foreground">
                {Math.round(f.nutrients.kcal ?? 0)} kcal · {f.serving_qty}{' '}
                {f.serving_unit}
                {f.brand ? ` · ${f.brand}` : ''}
              </div>
            </button>
          ))}
          {(foods ?? []).length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No foods found. Tap “Add a new food”.
            </div>
          )}
        </Card>
      </div>

      {selected && (
        <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 space-y-2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="text-sm font-medium">{selected.name}</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              className="w-24"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              × {selected.serving_qty} {selected.serving_unit}
            </span>
            <span className="ml-auto text-sm font-semibold">
              {Math.round(preview?.kcal ?? 0)} kcal
            </span>
          </div>
          <Button className="w-full" onClick={add} disabled={log.isPending}>
            {log.isPending ? 'Adding…' : `Add to ${meal}`}
          </Button>
        </div>
      )}
    </div>
  )
}
