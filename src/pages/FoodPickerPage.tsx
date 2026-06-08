import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Plus,
  Copy,
  ListChecks,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
  Loader2,
  Database,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useFoods,
  useDeleteFood,
  useFoodHistory,
  useSaveFood,
} from '@/features/foods/useFoods'
import { useDiary, useLogFood, useLogFoods, useCopyMeal } from '@/features/diary/useDiary'
import { scaleNutrients, servingOptions } from '@/lib/nutrients'
import {
  searchUsdaFoods,
  getUsdaFood,
  isUsdaConfigured,
  type UsdaSearchItem,
} from '@/lib/usda'
import { todayISO, addDaysISO } from '@/lib/date'
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
  const del = useDeleteFood()
  const { data: history } = useFoodHistory()
  const copyMeal = useCopyMeal()
  const [tab, setTab] = useState<'all' | 'recent' | 'frequent'>('all')
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyDate, setCopyDate] = useState(() => addDaysISO(date, -1))
  const { data: copySrc } = useDiary(copyDate)
  const saveFood = useSaveFood()
  const [usdaResults, setUsdaResults] = useState<UsdaSearchItem[]>([])
  const [usdaFor, setUsdaFor] = useState<string | null>(null)
  const [usdaLoading, setUsdaLoading] = useState(false)
  const [usdaErr, setUsdaErr] = useState('')
  const [importing, setImporting] = useState<number | null>(null)

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

  const removeFood = (f: Food) => {
    if (!confirm(`Remove "${f.name}" from your foods?`)) return
    if (selected?.id === f.id) setSelected(null)
    setPicks((prev) => prev.filter((p) => p.food.id !== f.id))
    del.mutate(f.id)
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

  const runUsda = async () => {
    const query = search.trim()
    if (!query) return
    setUsdaLoading(true)
    setUsdaErr('')
    try {
      setUsdaResults(await searchUsdaFoods(query))
      setUsdaFor(query)
    } catch (e) {
      setUsdaResults([])
      setUsdaFor(query)
      setUsdaErr(e instanceof Error ? e.message : 'USDA search failed')
    } finally {
      setUsdaLoading(false)
    }
  }

  // Import a USDA result into the library (per 100 g), then drop it into the
  // normal log flow — select it (serving sheet) or add to the multi-add picks.
  const pickUsda = async (item: UsdaSearchItem) => {
    setImporting(item.fdcId)
    setUsdaErr('')
    try {
      const d = await getUsdaFood(item.fdcId)
      const saved = await saveFood.mutateAsync({
        name: d.name,
        brand: d.brand,
        source: 'usda',
        source_id: d.source_id,
        serving_qty: d.serving_qty,
        serving_unit: d.serving_unit,
        serving_grams: d.serving_grams,
        recipe_servings: null,
        nutrients: d.nutrients,
        portions: [],
      })
      if (multi) {
        setPicks((prev) =>
          prev.some((p) => p.food.id === saved.id)
            ? prev
            : [...prev, { food: saved, servings: '1' }],
        )
      } else {
        setSelected(saved)
        setUnitId('base')
        setServings('1')
      }
    } catch (e) {
      setUsdaErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(null)
    }
  }

  const q = search.trim().toLowerCase()
  const byName = (arr: Food[]) =>
    q ? arr.filter((f) => f.name.toLowerCase().includes(q)) : arr
  const visible =
    tab === 'all'
      ? (foods ?? [])
      : tab === 'recent'
        ? byName(history?.recent ?? [])
        : byName(history?.frequent ?? [])
  const copyItems = (copySrc ?? []).filter((e) => e.meal === meal)

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
            onChange={(e) => {
              setSearch(e.target.value)
              setUsdaResults([])
              setUsdaFor(null)
              setUsdaErr('')
            }}
          />
        </div>
        <div className="flex rounded-lg bg-secondary p-0.5 text-sm">
          {(['all', 'recent', 'frequent'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded-md py-1.5 font-medium capitalize transition-colors',
                tab === t
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground active:bg-accent',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => nav('/foods/new')}>
            <Plus className="h-4 w-4" /> New food
          </Button>
          <Button variant="outline" onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" /> Copy day
          </Button>
        </div>
        <Card className="divide-y divide-border overflow-hidden">
          {visible.map((f) => {
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
                  <>
                    <button
                      onClick={() => editFood(f)}
                      className="shrink-0 p-3 text-muted-foreground active:text-primary"
                      aria-label={`Edit ${f.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => removeFood(f)}
                      className="shrink-0 p-3 text-muted-foreground active:text-destructive"
                      aria-label={`Remove ${f.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            )
          })}
          {visible.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {tab === 'all'
                ? 'No foods found. Tap “New food”.'
                : tab === 'recent'
                  ? 'No recent foods yet — log some foods first.'
                  : 'No frequent foods yet — log some foods first.'}
            </div>
          )}
        </Card>

        {isUsdaConfigured && tab === 'all' && search.trim() && (
          <div className="space-y-2">
            {usdaFor === search.trim() ? (
              usdaResults.length > 0 ? (
                <>
                  <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    USDA database
                  </div>
                  <Card className="divide-y divide-border overflow-hidden">
                    {usdaResults.map((r) => (
                      <button
                        key={r.fdcId}
                        onClick={() => pickUsda(r)}
                        disabled={importing != null}
                        className="flex w-full items-center gap-3 p-3 text-left active:bg-accent disabled:opacity-50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {r.description}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {r.brand ? `${r.brand} · ` : ''}
                            {r.dataType}
                          </div>
                        </div>
                        {importing === r.fdcId && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        )}
                      </button>
                    ))}
                  </Card>
                </>
              ) : (
                !usdaErr && (
                  <p className="px-1 text-sm text-muted-foreground">
                    No USDA matches for "{search.trim()}".
                  </p>
                )
              )
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={runUsda}
                disabled={usdaLoading}
              >
                {usdaLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching USDA…
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4" /> Search USDA for "
                    {search.trim()}"
                  </>
                )}
              </Button>
            )}
            {usdaErr && (
              <p className="px-1 text-sm text-destructive">{usdaErr}</p>
            )}
          </div>
        )}
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

      {copyOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setCopyOpen(false)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  Copy {meal} from another day
                </div>
                <div className="space-y-3 p-4">
                  <input
                    type="date"
                    value={copyDate}
                    max={addDaysISO(date, -1)}
                    onChange={(e) => setCopyDate(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                  {copyItems.length > 0 ? (
                    <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                      {copyItems.map((e) => (
                        <li
                          key={e.id}
                          className="flex justify-between gap-2 text-muted-foreground"
                        >
                          <span className="truncate">{e.food_name}</span>
                          <span className="shrink-0">
                            {Math.round((e.nutrients.kcal ?? 0) * e.servings)} kcal
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-2 text-center text-sm text-muted-foreground">
                      Nothing logged to {meal} on this day.
                    </p>
                  )}
                  <Button
                    className="w-full"
                    disabled={copyItems.length === 0 || copyMeal.isPending}
                    onClick={async () => {
                      const n = await copyMeal.mutateAsync({
                        from: copyDate,
                        to: date,
                        meal,
                      })
                      if (n > 0) nav('/')
                    }}
                  >
                    {copyMeal.isPending
                      ? 'Copying…'
                      : `Copy ${copyItems.length} ${
                          copyItems.length === 1 ? 'item' : 'items'
                        }`}
                  </Button>
                </div>
              </Card>
              <button
                onClick={() => setCopyOpen(false)}
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
