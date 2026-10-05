import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { MacroPie, SECTIONS } from '@/components/NutrientBreakdown'
import { RING_GREEN, RING_OVER } from '@/components/CalorieRing'
import { useDiary } from '@/features/diary/useDiary'
import { useProfile } from '@/features/profile/useProfile'
import { useLatestWeight } from '@/features/measurements/useMeasurements'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import {
  useMicronutrientTrends,
  type MicroStat,
} from '@/features/insights/useMicronutrientTrends'
import {
  goalForDate,
  resolveCalorieGoal,
  resolveMacroTargets,
  type ResolvedMacros,
} from '@/lib/calc'
import {
  NUTRIENT_BY_KEY,
  formatNutrient,
  scaleNutrients,
  sumNutrients,
} from '@/lib/nutrients'
import { todayISO, dateLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { Meal, NutrientKey, Nutrients } from '@/lib/database.types'

/** A logged item's scaled nutrient totals, for the per-food contributor view. */
type Source = { name: string; n: Nutrients }

export function DiaryNutrientsPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = params.get('meal') as Meal | null
  const { data: entries } = useDiary(date)
  const { data: profile } = useProfile()
  const { data: weight } = useLatestWeight()
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
  const sources: Source[] = [
    ...scoped.map((e) => ({
      name: e.food_name,
      n: scaleNutrients(e.nutrients, e.servings),
    })),
    ...(withSupp
      ? supplements.map((s) => ({
          name: s.food.name,
          n: scaleNutrients(s.food.nutrients, s.servings),
        }))
      : []),
  ]

  // Calorie goal as of the viewed day (non-retroactive) + the user's macro
  // targets — macro rows fill toward those instead of the generic FDA DV.
  const goalRes = profile ? resolveCalorieGoal(profile, weight ?? null) : null
  const goal = profile
    ? goalForDate(profile.calorie_goal_history, date, goalRes?.goal ?? null, todayISO())
    : null
  const macroTargets =
    goal != null && profile
      ? resolveMacroTargets(goal, weight ?? null, profile.macro_targets)
      : null

  const [open, setOpen] = useState<NutrientKey | null>(null)

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
      <div className="space-y-4 p-4">
        {!meal && <WeeklyNudge date={date} />}
        <MacroPie nutrients={total} />
        {SECTIONS.map((sec, si) => (
          <div key={si}>
            {sec.title && (
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {sec.title}
              </div>
            )}
            <div className="divide-y divide-border rounded-lg border border-border">
              {sec.keys.map((k) =>
                k === 'kcal' ? (
                  <div
                    key={k}
                    className="flex items-center justify-between bg-muted px-3 py-2 text-sm font-semibold"
                  >
                    <span>Calories</span>
                    <span>
                      {typeof total.kcal === 'number'
                        ? formatNutrient(total.kcal)
                        : '—'}
                      {!meal && goal != null && (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          / {Math.round(goal)}
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                  <NutrientRow
                    key={k}
                    k={k}
                    total={total}
                    indent={sec.indent?.includes(k) ?? false}
                    macroTargets={macroTargets}
                    sources={sources}
                    open={open === k}
                    onToggle={() => setOpen((o) => (o === k ? null : k))}
                  />
                ),
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Bars show % of Daily Value (protein, carbs, and fat: % of your
          target). Green = met, red = over a limit. “—” means the food has no
          data for that nutrient. Tap a row to see its top food sources.
        </p>
        {withSupp && (
          <p className="text-xs text-muted-foreground">
            Includes your daily{' '}
            {supplements.map((s) => s.food.name).join(', ')} — taken every day,
            not logged to your diary.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * One nutrient row: value + %-of-target with a fill bar (floors and macros aim
 * for 100%, limits stay under it), expanding on tap to the foods that
 * contributed most today.
 */
function NutrientRow({
  k,
  total,
  indent,
  macroTargets,
  sources,
  open,
  onToggle,
}: {
  k: NutrientKey
  total: Nutrients
  indent: boolean
  macroTargets: ResolvedMacros | null
  sources: Source[]
  open: boolean
  onToggle: () => void
}) {
  const def = NUTRIENT_BY_KEY[k]
  const v = total[k]
  const has = typeof v === 'number'
  const isMacro = k === 'protein' || k === 'carb' || k === 'fat'
  // Macros fill toward the user's own targets (falling back to the FDA DV
  // before the profile loads); floors/limits toward the FDA DV.
  const target = isMacro
    ? (macroTargets?.[k].grams ?? def.dv)
    : def.direction != null
      ? def.dv
      : null
  const kind = isMacro ? 'floor' : def.direction
  const pct = has && target ? (v / target) * 100 : null

  const contribs = sources
    .map((s) => ({ name: s.name, amt: s.n[k] }))
    .filter((c): c is { name: string; amt: number } =>
      typeof c.amt === 'number' && c.amt > 0,
    )
    .sort((a, b) => b.amt - a.amt)
  const expandable = has && contribs.length > 0

  const met = kind === 'floor' && pct != null && pct >= 100
  const over = kind === 'limit' && pct != null && pct > 100
  const barColor =
    kind === 'limit'
      ? over
        ? RING_OVER
        : RING_GREEN
      : met
        ? RING_GREEN
        : 'var(--primary)'

  const Row = expandable ? 'button' : 'div'
  return (
    <div className="px-3 py-2 text-sm">
      <Row
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={expandable ? onToggle : undefined}
        {...(expandable ? { type: 'button' as const, 'aria-expanded': open } : {})}
      >
        <span className={cn(indent && 'pl-4 text-muted-foreground')}>
          {def.label}
        </span>
        <span className="flex items-center gap-2">
          <span className={cn(!has && 'text-muted-foreground')}>
            {has ? `${formatNutrient(v)} ${def.unit}` : '—'}
          </span>
          {pct != null && (
            <span
              className={cn(
                'flex w-10 items-center justify-end text-right text-xs',
                over ? '' : met ? '' : 'text-muted-foreground',
              )}
              style={over ? { color: RING_OVER } : undefined}
            >
              {met ? (
                <Check className="h-3.5 w-3.5" style={{ color: RING_GREEN }} />
              ) : (
                `${Math.round(pct)}%`
              )}
            </span>
          )}
          {expandable ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
        </span>
      </Row>
      {pct != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, pct)}%`, background: barColor }}
          />
        </div>
      )}
      {open && expandable && (
        <div className="mt-2 space-y-1.5 pb-1">
          {contribs.slice(0, 5).map((c, i) => {
            const share = v! > 0 ? (c.amt / v!) * 100 : 0
            return (
              <div key={i}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {c.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatNutrient(c.amt)} {def.unit} · {Math.round(share)}%
                  </span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full opacity-70"
                    style={{
                      width: `${Math.min(100, share)}%`,
                      background: barColor,
                    }}
                  />
                </div>
              </div>
            )
          })}
          {contribs.length > 5 && (
            <p className="pt-0.5 text-xs text-muted-foreground">
              + {contribs.length - 5} more{' '}
              {contribs.length - 5 === 1 ? 'food' : 'foods'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Weekly micronutrient nudge: a plain-language pointer to what you've been
// consistently low/high on over the last 7 logged days. Reuses the Progress →
// Nutrition analysis (useMicronutrientTrends) and folds in a daily supplement.
// A rolling weekly insight, so the caller only mounts it on today's whole-day
// view. Hidden on an on-track week or before anything's logged this week.
function WeeklyNudge({ date }: { date: string }) {
  const nav = useNavigate()
  const { dailyMicros } = useDailySupplements()
  const { data } = useMicronutrientTrends(7, dailyMicros)
  if (date !== todayISO() || !data || data.loggedCount === 0) return null

  const low = data.stats.filter((s) => s.direction === 'floor' && s.flagged)
  // Curated to the two limits worth a daily nudge; Progress shows the rest.
  const over = data.stats.filter(
    (s) => s.flagged && (s.key === 'sodium' || s.key === 'added_sugar'),
  )
  if (low.length === 0 && over.length === 0) return null

  const names = (arr: MicroStat[]) => {
    const shown = arr.slice(0, 3).map((s) => s.label).join(', ')
    return arr.length > 3 ? `${shown} +${arr.length - 3} more` : shown
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-border p-3">
      {low.length > 0 && (
        <button
          onClick={() => nav('/progress?view=nutrition')}
          className="block w-full text-center text-xs font-medium text-primary"
        >
          Low this week: {names(low)} →
        </button>
      )}
      {over.length > 0 && (
        <button
          onClick={() => nav('/progress?view=nutrition')}
          className="block w-full text-center text-xs font-medium"
          style={{ color: RING_OVER }}
        >
          Over this week: {names(over)} →
        </button>
      )}
    </div>
  )
}
