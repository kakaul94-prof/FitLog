import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Plus,
  ListChecks,
  CheckCircle2,
  Circle,
  Pencil,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFoods } from '@/features/foods/useFoods'
import { useLogFood, useLogFoods } from '@/features/diary/useDiary'
import { scaleNutrients, servingOptions } from '@/lib/nutrients'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Food, Meal } from '@/lib/database.types'

type Pick = { food: Food; servings: string }

export function FoodPickerPage() {
  const nav = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = (params.get('meal') || 'breakfast') as Meal
  const [search, setSearch] = useState('')
  const { data: foods } = useFoods(search)
  const [multi, setMulti] = useState(false)
  const [selected, setSelected] = useState<Food | null>(null)
  const [servings, setServings] = useState('1')
  const [unitId, setUnitId] = useState('base')
  const [picks, setPicks] = useState<Pick[]>([])
  const log = useLogFood()
  const logMany = useLogFoods()

  const isPicked = (id: string) => picks.some((p) => p.food.id === id)

  const toggleMulti = () => {
    if (multi) {
      setMulti(false)
      setPicks([])
    } else {
      // carry a single selection over so you don't lose it switching modes
      setPicks(selected ? [{ food: selected, servings }] : [])
      setSelected(null)
      setMulti(true)
    }
  }

  const onRowTap = (f: Food) => {
    if (!multi) {
      setSelected(f)
      setUnitId('base')
      setServings('1')
      return
    }
    setPicks((prev) =>
      prev.some((p) => p.food.id === f.id)
        ? prev.filter((p) => p.food.id !== f.id)
        : [...prev, { food: f, servings: '1' }],
    )
  }

  const editFood = (f: Food) => {
    const back = encodeURIComponent(location.pathname + location.search)
    nav(`/foods/${f.id}?returnTo=${back}`)
  }

  const add = async () => {
    if (!selected || !chosen) return
    await log.mutateAsync({
      entry_date: date,
      meal,
      food: selected,
      servings: parseFloat(servings) || 1,
      unit: {
        serving_qty: chosen.qty,
        serving_unit: chosen.label,
        nutrients: chosen.nutrients,
      },
    })
    nav('/')
  }

  const addMany = async () => {
    if (picks.length === 0) return
    await logMany.mutateAsync({
      entry_date: date,
      meal,
      items: picks.map((p) => ({
        food: p.food,
        servings: parseFloat(p.servings) || 1,
      })),
    })
    nav('/')
  }

  const options = selected ? servingOptions(selected) : []
  const chosen = options.find((o) => o.id === unitId) ?? options[0]
  const preview = chosen
    ? scaleNutrients(chosen.nutrients, parseFloat(servings) || 0)
    : null

  const multiKcal = picks.reduce(
    (s, p) => s + (p.food.nutrients.kcal ?? 0) * (parseFloat(p.servings) || 0),
    0,
  )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title={`Add to ${meal}`}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            variant={multi ? 'secondary' : 'ghost'}
            size="sm"
            onClick={toggleMulti}
          >
            <ListChecks className="h-4 w-4" /> Multi-add
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
          {(foods ?? []).map((f) => {
            const active = multi ? isPicked(f.id) : selected?.id === f.id
            return (
              <div
                key={f.id}
                className={cn('flex items-center', active && 'bg-accent')}
              >
                <button
                  onClick={() => onRowTap(f)}
                  className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left active:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{f.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {Math.round(f.nutrients.kcal ?? 0)} kcal · {f.serving_qty}{' '}
                      {f.serving_unit}
                      {f.brand ? ` · ${f.brand}` : ''}
                    </div>
                  </div>
                  {multi &&
                    (isPicked(f.id) ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                    ))}
                </button>
                {!multi && (
                  <button
                    onClick={() => editFood(f)}
                    className="shrink-0 p-3 text-muted-foreground active:text-primary"
                    aria-label={`Edit ${f.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })}
          {(foods ?? []).length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No foods found. Tap “Add a new food”.
            </div>
          )}
        </Card>
      </div>

      {!multi && selected && (
        <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 space-y-2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="text-sm font-medium">{selected.name}</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              className="w-20"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">×</span>
            {options.length > 1 ? (
              <select
                value={chosen?.id}
                onChange={(e) => setUnitId(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.qty === 1 ? o.label : `${o.qty} ${o.label}`}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-muted-foreground">
                {selected.serving_qty} {selected.serving_unit}
              </span>
            )}
            <span className="ml-auto shrink-0 text-sm font-semibold">
              {Math.round(preview?.kcal ?? 0)} kcal
            </span>
          </div>
          <Button className="w-full" onClick={add} disabled={log.isPending}>
            {log.isPending ? 'Adding…' : `Add to ${meal}`}
          </Button>
        </div>
      )}

      {multi && picks.length > 0 && (
        <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 space-y-2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {picks.length} {picks.length === 1 ? 'food' : 'foods'} selected
            </span>
            <span className="font-semibold">{Math.round(multiKcal)} kcal</span>
          </div>
          <Button
            className="w-full"
            onClick={addMany}
            disabled={logMany.isPending}
          >
            {logMany.isPending ? 'Adding…' : `Add ${picks.length} to ${meal}`}
          </Button>
        </div>
      )}
    </div>
  )
}
