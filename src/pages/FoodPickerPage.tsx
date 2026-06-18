import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Plus,
  Minus,
  Copy,
  ListChecks,
  CheckCircle2,
  Circle,
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
import { useMeals, useLogMeal, type MealWithItems } from '@/features/meals/useMeals'
import {
  searchUsdaFoods,
  getUsdaFood,
  isUsdaConfigured,
  type UsdaSearchItem,
} from '@/lib/usda'
import { todayISO, addDaysISO } from '@/lib/date'
import { scaleNutrients } from '@/lib/nutrients'
import { cn } from '@/lib/utils'
import { useLongPress } from '@/lib/useLongPress'
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
  // Returning from "New food" pre-selects the just-created food for one-tap add.
  const justAdded = (location.state as { addFood?: Food } | null)?.addFood
  const [multi, setMulti] = useState(!!justAdded)
  const [picks, setPicks] = useState<Pick[]>(
    justAdded ? [{ food: justAdded, servings: '1' }] : [],
  )
  const logMany = useLogFoods()
  const logOne = useLogFood()
  const del = useDeleteFood()
  const { data: history } = useFoodHistory()
  const copyMeal = useCopyMeal()
  const { data: meals } = useMeals()
  const logMeal = useLogMeal()
  const [mealToLog, setMealToLog] = useState<MealWithItems | null>(null)
  const [tab, setTab] = useState<'all' | 'recent' | 'frequent' | 'meals'>('all')
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyDate, setCopyDate] = useState(() => addDaysISO(date, -1))
  const { data: copySrc } = useDiary(copyDate)
  const saveFood = useSaveFood()
  const [usdaResults, setUsdaResults] = useState<UsdaSearchItem[]>([])
  const [usdaFor, setUsdaFor] = useState<string | null>(null)
  const [usdaLoading, setUsdaLoading] = useState(false)
  const [usdaErr, setUsdaErr] = useState('')
  const [importing, setImporting] = useState<number | null>(null)
  const [menuFood, setMenuFood] = useState<Food | null>(null)
  const [servingFood, setServingFood] = useState<Food | null>(null)
  // Item (2): stay in the picker after adding; show a running tally + a toast.
  const [tally, setTally] = useState({ count: 0, kcal: 0 })
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])
  const noteAdded = (count: number, kcal: number, label: string) => {
    setTally((p) => ({ count: p.count + count, kcal: p.kcal + kcal }))
    setToast(label)
  }

  const isPicked = (id: string) => picks.some((p) => p.food.id === id)

  const toggleMulti = () => {
    setMulti((m) => !m)
    setPicks([])
  }

  // Tapping a food opens its page (set details there + "Add to {meal}").
  const openFood = (f: Food) => {
    const back = encodeURIComponent(location.pathname + location.search)
    nav(`/foods/${f.id}?meal=${meal}&date=${date}&returnTo=${back}`)
  }

  // "New food" carries the meal context so saving returns here (pre-selected).
  const newFood = () => {
    const back = encodeURIComponent(location.pathname + location.search)
    nav(`/foods/new?meal=${meal}&date=${date}&returnTo=${back}`)
  }

  const onRowTap = (f: Food) => {
    if (!multi) {
      setServingFood(f)
      return
    }
    setPicks((prev) =>
      prev.some((p) => p.food.id === f.id)
        ? prev.filter((p) => p.food.id !== f.id)
        : [...prev, { food: f, servings: '1' }],
    )
  }

  // The long-press menu is the confirmation step (matches the diary entries).
  const removeFood = (f: Food) => {
    setPicks((prev) => prev.filter((p) => p.food.id !== f.id))
    del.mutate(f.id)
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
    noteAdded(
      picks.length,
      multiKcal,
      `Added ${picks.length} ${picks.length === 1 ? 'item' : 'items'}`,
    )
    setPicks([])
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
  // normal log flow — open its food page, or add to the multi-add picks.
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
        setServingFood(saved)
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
  const mealList = (meals ?? []).filter(
    (m) => !q || m.name.toLowerCase().includes(q),
  )

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
          {(['all', 'recent', 'frequent', 'meals'] as const).map((t) => (
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
        {tab === 'meals' ? (
          <Card className="divide-y divide-border overflow-hidden">
            {mealList.map((m) => {
              const kcal = Math.round(
                m.items.reduce(
                  (s, it) => s + (it.nutrients.kcal ?? 0) * it.servings,
                  0,
                ),
              )
              return (
                <button
                  key={m.id}
                  onClick={() => setMealToLog(m)}
                  className="flex w-full items-center gap-3 p-3 text-left active:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.items.length} {m.items.length === 1 ? 'item' : 'items'}{' '}
                      · {kcal} calories
                    </div>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )
            })}
            {mealList.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No saved meals yet. On the diary, long-press an entry → “Select
                multiple” → “Save as meal”.
              </div>
            )}
          </Card>
        ) : (
          <>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={newFood}>
            <Plus className="h-4 w-4" /> New food
          </Button>
          <Button variant="outline" onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" /> Copy day
          </Button>
        </div>
        <Card className="divide-y divide-border overflow-hidden">
          {visible.map((f) => (
            <FoodRow
              key={f.id}
              food={f}
              multi={multi}
              picked={multi && isPicked(f.id)}
              onTap={() => onRowTap(f)}
              onMenu={() => setMenuFood(f)}
            />
          ))}
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
          </>
        )}
      </div>

      {multi && picks.length > 0 && (
        <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 space-y-2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {picks.length} {picks.length === 1 ? 'food' : 'foods'} selected
            </span>
            <span className="font-semibold">{Math.round(multiKcal)} calories</span>
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

      {tally.count > 0 && !(multi && picks.length > 0) && (
        <div className="fixed bottom-0 left-1/2 flex w-full max-w-md -translate-x-1/2 items-center justify-between gap-3 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{tally.count}</span>{' '}
            added · {Math.round(tally.kcal)} cal
          </span>
          <Button size="sm" onClick={() => nav('/')}>
            Done
          </Button>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {toast}
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
                            {Math.round((e.nutrients.kcal ?? 0) * e.servings)} calories
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

      {mealToLog &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setMealToLog(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="border-b border-border p-3 text-center text-sm font-medium">
                  {mealToLog.name}
                </div>
                <div className="space-y-3 p-4">
                  <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                    {mealToLog.items.map((it) => (
                      <li
                        key={it.id}
                        className="flex justify-between gap-2 text-muted-foreground"
                      >
                        <span className="truncate">{it.food_name}</span>
                        <span className="shrink-0">
                          {Math.round((it.nutrients.kcal ?? 0) * it.servings)}{' '}
                          calories
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    disabled={
                      mealToLog.items.length === 0 || logMeal.isPending
                    }
                    onClick={async () => {
                      const n = await logMeal.mutateAsync({
                        meal_id: mealToLog.id,
                        entry_date: date,
                        meal,
                      })
                      if (n > 0)
                        noteAdded(
                          n,
                          mealToLog.items.reduce(
                            (s, it) =>
                              s + (it.nutrients.kcal ?? 0) * it.servings,
                            0,
                          ),
                          `Added ${mealToLog.name}`,
                        )
                      setMealToLog(null)
                    }}
                  >
                    {logMeal.isPending
                      ? 'Adding…'
                      : `Add ${mealToLog.items.length} to ${meal}`}
                  </Button>
                </div>
              </Card>
              <button
                onClick={() => setMealToLog(null)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}

      {menuFood &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
            onClick={() => setMenuFood(null)}
          >
            <div
              className="mx-auto w-full max-w-md p-3"
              onClick={(ev) => ev.stopPropagation()}
            >
              <Card className="overflow-hidden">
                <div className="truncate border-b border-border p-3 text-center text-xs text-muted-foreground">
                  {menuFood.name}
                </div>
                <button
                  onClick={() => {
                    removeFood(menuFood)
                    setMenuFood(null)
                  }}
                  className="flex w-full items-center gap-3 p-4 text-left text-destructive active:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Delete food</span>
                </button>
              </Card>
              <button
                onClick={() => setMenuFood(null)}
                className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}

      {servingFood && (
        <ServingSheet
          food={servingFood}
          meal={meal}
          pending={logOne.isPending}
          onClose={() => setServingFood(null)}
          onAdd={async (s) => {
            await logOne.mutateAsync({
              entry_date: date,
              meal,
              food: servingFood,
              servings: s,
            })
            noteAdded(
              1,
              (servingFood.nutrients.kcal ?? 0) * s,
              `Added ${servingFood.name}`,
            )
            setServingFood(null)
          }}
          onEditDetails={() => openFood(servingFood)}
        />
      )}
    </div>
  )
}

const ROW_CLASS =
  'flex w-full select-none items-center gap-3 p-3 text-left [-webkit-touch-callout:none] active:bg-accent'

function FoodRow({
  food,
  multi,
  picked,
  onTap,
  onMenu,
}: {
  food: Food
  multi: boolean
  picked: boolean
  onTap: () => void
  onMenu: () => void
}) {
  const press = useLongPress(onMenu, onTap)
  const body = (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium">{food.name}</div>
      <div className="text-xs text-muted-foreground">
        {Math.round(food.nutrients.kcal ?? 0)} calories · {food.serving_qty}{' '}
        {food.serving_unit}
        {food.brand ? ` · ${food.brand}` : ''}
      </div>
    </div>
  )
  // Multi-add: plain tap toggles the pick (no long-press menu, matches diary).
  if (multi) {
    return (
      <button onClick={onTap} className={cn(ROW_CLASS, picked && 'bg-accent')}>
        {body}
        {picked ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
        ) : (
          <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
        )}
      </button>
    )
  }
  return (
    <button {...press} className={ROW_CLASS}>
      {body}
    </button>
  )
}

// Quick-log sheet: set how many servings, preview the scaled nutrition, log it.
// Keeps the common "just log it" path off the full FoodFormPage editor.
function ServingSheet({
  food,
  meal,
  pending,
  onClose,
  onAdd,
  onEditDetails,
}: {
  food: Food
  meal: Meal
  pending: boolean
  onClose: () => void
  onAdd: (servings: number) => void
  onEditDetails: () => void
}) {
  const [servings, setServings] = useState('1')
  const s = parseFloat(servings) || 0
  const scaled = scaleNutrients(food.nutrients, s)
  const step = (delta: number) =>
    setServings((prev) => {
      const next = Math.max(
        0,
        Math.round(((parseFloat(prev) || 0) + delta) * 100) / 100,
      )
      return String(next)
    })

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="border-b border-border p-3 text-center">
            <div className="truncate text-sm font-medium">{food.name}</div>
            {food.brand && (
              <div className="truncate text-xs text-muted-foreground">
                {food.brand}
              </div>
            )}
          </div>
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => step(-1)}
                disabled={s <= 0}
                aria-label="Decrease servings"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="number"
                inputMode="decimal"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                onFocus={(e) => e.target.select()}
                className="w-24 text-center text-lg font-semibold"
                autoFocus
                aria-label="Servings"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => step(1)}
                aria-label="Increase servings"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              × {food.serving_qty} {food.serving_unit}
            </p>
            <div className="rounded-lg bg-secondary p-3">
              <div className="text-center">
                <span className="text-2xl font-bold">
                  {Math.round(scaled.kcal ?? 0)}
                </span>
                <span className="text-xs text-muted-foreground"> calories</span>
              </div>
              <div className="mt-2 flex justify-around text-center text-xs text-muted-foreground">
                <span>Protein {Math.round(scaled.protein ?? 0)}g</span>
                <span>Carbs {Math.round(scaled.carb ?? 0)}g</span>
                <span>Fat {Math.round(scaled.fat ?? 0)}g</span>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={s <= 0 || pending}
              onClick={() => onAdd(s)}
            >
              {pending ? 'Adding…' : `Add to ${meal}`}
            </Button>
            <button
              onClick={onEditDetails}
              className="w-full text-center text-xs font-medium text-primary"
            >
              Edit food details →
            </button>
          </div>
        </Card>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-card p-4 text-sm font-medium active:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}
