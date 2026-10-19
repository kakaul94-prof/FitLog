import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, Search, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useDiary,
  useCopyMeal,
  useMealHistory,
  type PastMealRow,
} from '@/features/diary/useDiary'
import { addDaysISO, dateLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Meal } from '@/lib/database.types'

const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks']
const MAX_RESULTS = 30
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Item = { id: string; name: string; kcal: number }
type PastMeal = { date: string; meal: Meal; items: Item[]; kcal: number }

const toItem = (r: { id: string; food_name: string; servings: number; kcal: number | null }): Item => ({
  id: r.id,
  name: r.food_name,
  kcal: Math.round((r.kcal ?? 0) * r.servings),
})

/** Group rows into one meal per (day, meal slot): newest day first, then
 *  breakfast → snacks within a day. */
function groupMeals(rows: PastMealRow[], excludeDate: string): PastMeal[] {
  const byKey = new Map<string, PastMeal>()
  for (const r of rows) {
    if (r.entry_date === excludeDate) continue
    const key = `${r.entry_date}|${r.meal}`
    let m = byKey.get(key)
    if (!m) {
      m = { date: r.entry_date, meal: r.meal, items: [], kcal: 0 }
      byKey.set(key, m)
    }
    const item = toItem(r)
    m.items.push(item)
    m.kcal += item.kcal
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal),
  )
}

/**
 * Copy a past meal into `meal` on `date`. Search by any food name across the
 * last 60 days, or pick a date; every item starts ticked and can be unticked.
 */
export function CopyMealSheet({
  date,
  meal,
  onClose,
  onCopied,
}: {
  date: string
  meal: Meal
  onClose: () => void
  onCopied: () => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<PastMeal | null>(null)
  const [pickDate, setPickDate] = useState(() => addDaysISO(date, -1))
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const { data: history, isLoading: historyLoading } = useMealHistory()
  const { data: daySrc } = useDiary(pickDate)
  const copyMeal = useCopyMeal()

  const pastMeals = useMemo(() => groupMeals(history ?? [], date), [history, date])
  const term = q.trim().toLowerCase()
  const results = useMemo(
    () =>
      term
        ? pastMeals.filter((m) => m.items.some((i) => i.name.toLowerCase().includes(term)))
        : [],
    [pastMeals, term],
  )

  // The items on offer: a tapped search result, else the picked date's meal.
  const items: Item[] = picked
    ? picked.items
    : (daySrc ?? [])
        .filter((e) => e.meal === meal)
        .map((e) => toItem({ ...e, kcal: e.nutrients.kcal ?? null }))
  const chosen = items.filter((i) => !unchecked.has(i.id))
  const chosenKcal = chosen.reduce((s, i) => s + i.kcal, 0)
  const showResults = !picked && term.length > 0

  const toggle = (id: string) =>
    setUnchecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="mx-auto w-full max-w-md p-3" onClick={(ev) => ev.stopPropagation()}>
        <Card className="overflow-hidden">
          <div className="border-b border-border p-3 text-center text-sm font-medium">
            Copy to {cap(meal)}
          </div>
          <div className="space-y-3 p-4">
            {picked ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setPicked(null)
                    setUnchecked(new Set())
                  }}
                  className="flex items-center gap-0.5 font-medium text-primary"
                >
                  <ChevronLeft className="h-4 w-4" /> Results
                </button>
                <span className="text-muted-foreground">
                  {dateLabel(picked.date)} · {cap(picked.meal)}
                </span>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 pr-9"
                  placeholder="Search past meals by food"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {q && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQ('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {showResults ? (
              historyLoading ? (
                <p className="py-2 text-center text-sm text-muted-foreground">Loading…</p>
              ) : results.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">
                  No meals with “{q.trim()}” in the last 60 days.
                </p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-auto text-sm">
                  {results.slice(0, MAX_RESULTS).map((m) => (
                    <li key={`${m.date}|${m.meal}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(m)
                          setUnchecked(new Set())
                        }}
                        className="flex w-full items-center gap-2 py-2 text-left active:bg-accent"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between gap-2 font-medium">
                            <span>
                              {dateLabel(m.date)} · {cap(m.meal)}
                            </span>
                            <span className="shrink-0 font-normal text-muted-foreground">
                              {m.kcal} cal
                            </span>
                          </div>
                          <div className="truncate text-muted-foreground">
                            {m.items.map((i) => i.name).join(', ')}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                  {results.length > MAX_RESULTS && (
                    <li className="py-2 text-center text-xs text-muted-foreground">
                      Showing the {MAX_RESULTS} most recent
                    </li>
                  )}
                </ul>
              )
            ) : (
              <>
                {!picked && (
                  <>
                    <div className="text-center text-xs text-muted-foreground">or pick a date</div>
                    <input
                      type="date"
                      aria-label="Copy from date"
                      value={pickDate}
                      max={addDaysISO(date, -1)}
                      onChange={(e) => {
                        setPickDate(e.target.value)
                        setUnchecked(new Set())
                      }}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </>
                )}
                {items.length > 0 ? (
                  <ul className="max-h-60 space-y-0.5 overflow-auto text-sm">
                    {items.map((i) => {
                      const on = !unchecked.has(i.id)
                      return (
                        <li key={i.id}>
                          <button
                            type="button"
                            onClick={() => toggle(i.id)}
                            className="flex w-full items-center gap-2 py-1.5 text-left"
                          >
                            {on ? (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                            ) : (
                              <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                            )}
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate',
                                !on && 'text-muted-foreground',
                              )}
                            >
                              {i.name}
                            </span>
                            <span className="shrink-0 text-muted-foreground">{i.kcal} cal</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    Nothing logged to {meal} on this day.
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={chosen.length === 0 || copyMeal.isPending}
                  onClick={async () => {
                    const n = await copyMeal.mutateAsync({
                      ids: chosen.map((i) => i.id),
                      to: date,
                      meal,
                    })
                    if (n > 0) onCopied()
                  }}
                >
                  {copyMeal.isPending
                    ? 'Copying…'
                    : `Copy ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} · ${chosenKcal} cal`}
                </Button>
              </>
            )}
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
