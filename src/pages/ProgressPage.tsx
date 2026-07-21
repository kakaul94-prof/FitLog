import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LineChartSvg } from '@/components/LineChartSvg'
import { CalorieBars } from '@/components/CalorieBars'
import { RING_GREEN, RING_OVER } from '@/components/CalorieRing'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useMeasurements,
  useLogMeasurement,
  useUpdateMeasurement,
  useDeleteMeasurement,
  useLatestWeight,
} from '@/features/measurements/useMeasurements'
import type { Measurement } from '@/lib/database.types'
import { useProfile } from '@/features/profile/useProfile'
import { useNutritionTrends } from '@/features/insights/useNutritionTrends'
import {
  useMicronutrientTrends,
  type MicroStat,
} from '@/features/insights/useMicronutrientTrends'
import { useNutrientSources } from '@/features/insights/useNutrientSources'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import { NUTRIENTS, NUTRIENT_BY_KEY, formatNutrient } from '@/lib/nutrients'
import type { NutrientKey } from '@/lib/database.types'
import { useCardioZoneTrends } from '@/features/insights/useCardioZoneTrends'
import { useDistanceTrends } from '@/features/insights/useDistanceTrends'
import { ZoneBars } from '@/components/ZoneBars'
import { DistanceBars } from '@/components/DistanceBars'
import {
  movingAverage,
  bmi,
  goalForDate,
  resolveCalorieGoal,
  resolveMacroTargets,
} from '@/lib/calc'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const TYPES = [
  { type: 'weight', label: 'Weight', unit: 'lb' },
  { type: 'body_fat', label: 'Body fat', unit: '%' },
  { type: 'waist', label: 'Waist', unit: 'in' },
]

const GREEN = '#16a34a'
const GRAY = '#9ca3af'

export function ProgressPage() {
  // Allow deep-linking to a segment, e.g. the diary's weekly nudge → Nutrition.
  const [params] = useSearchParams()
  const requested = params.get('view')
  const [view, setView] = useState<'body' | 'nutrition' | 'cardio'>(
    requested === 'nutrition' || requested === 'cardio' ? requested : 'body',
  )
  return (
    <div>
      <PageHeader title="Progress" />
      <div className="space-y-4 p-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'body', label: 'Body' },
            { value: 'nutrition', label: 'Nutrition' },
            { value: 'cardio', label: 'Cardio' },
          ]}
        />
        {view === 'body' ? (
          <BodyView />
        ) : view === 'nutrition' ? (
          <NutritionView />
        ) : (
          <CardioView />
        )}
      </div>
    </div>
  )
}

const fmtMi = (mi: number) => (Math.round(mi * 10) / 10).toString()

function CardioView() {
  const [range, setRange] = useState<'7' | '30'>('7')
  const { data, isLoading } = useCardioZoneTrends(Number(range))
  const { data: dist, isLoading: distLoading } = useDistanceTrends(Number(range))
  return (
    <div className="space-y-4">
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
        ]}
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-baseline justify-between">
            <CardTitle className="text-base">Distance</CardTitle>
            <span className="text-xs text-muted-foreground">
              last {range} days
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {distLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !dist || dist.totalMi === 0 ? (
            <p className="text-sm text-muted-foreground">
              No distance logged in this range. Add miles when you log a walk,
              run, or hike to see your total here.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tabular-nums">
                  {fmtMi(dist.totalMi)}
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  mi
                </span>
              </div>
              <DistanceBars bins={dist.bins} />
              <p className="text-xs text-muted-foreground">
                {fmtMi(dist.totalMi)} mi across {dist.walks}{' '}
                {dist.walks === 1 ? 'walk' : 'walks'}
                {dist.activeDays > 0 &&
                  ` · avg ${fmtMi(dist.totalMi / dist.activeDays)} mi/day`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Time in zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !data || data.sessions === 0 ? (
            <p className="text-sm text-muted-foreground">
              No zoned cardio in this range. Add an average HR or tap a zone when
              you log cardio to see your weekly split here.
            </p>
          ) : (
            <>
              <ZoneBars data={data.zones} />
              <p className="text-xs text-muted-foreground">
                {data.totalMinutes} min across {data.sessions}{' '}
                {data.sessions === 1 ? 'session' : 'sessions'}. Only sessions with
                a logged zone and duration are counted.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function BodyView() {
  const [type, setType] = useState('weight')
  const meta = TYPES.find((t) => t.type === type) ?? TYPES[0]
  const { data: rows, isLoading: mLoading } = useMeasurements(type)
  const { data: profile } = useProfile()
  const logM = useLogMeasurement()
  const updM = useUpdateMeasurement()
  const delM = useDeleteMeasurement()
  const [val, setVal] = useState('')
  const [on, setOn] = useState(todayISO())

  // Guard against rows with a missing/blank date or non-numeric value — either
  // would throw later (e.g. `t.date.slice(5)`) and blank the whole page.
  const points = (rows ?? [])
    .map((r) => ({ date: r.measured_on, value: Number(r.value) }))
    .filter((p) => typeof p.date === 'string' && p.date.length > 0 && Number.isFinite(p.value))
  const trend = movingAverage(points, 7)
  const latest = points.length ? points[points.length - 1].value : null
  const first = points.length ? points[0].value : null
  const change = latest != null && first != null ? latest - first : null

  const chartData = trend.map((t) => ({
    date: String(t.date).slice(5),
    value: t.value,
    trend: Math.round(t.trend * 10) / 10,
  }))

  const bmiVal =
    type === 'weight' && latest != null && profile?.height_cm
      ? bmi(latest, profile.height_cm)
      : null

  const add = async () => {
    const v = parseFloat(val)
    if (Number.isNaN(v)) return
    await logM.mutateAsync({
      type,
      value: v,
      unit: meta.unit,
      measured_on: on,
    })
    setVal('')
    setOn(todayISO())
  }

  return (
    <>
      <Select value={type} onChange={(e) => setType(e.target.value)}>
        {TYPES.map((t) => (
          <option key={t.type} value={t.type}>
            {t.label}
          </option>
        ))}
      </Select>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium">
                Log {meta.label.toLowerCase()} ({meta.unit})
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={latest != null ? String(latest) : '—'}
              />
            </div>
            <Button onClick={add} disabled={logM.isPending || !val}>
              Add
            </Button>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date</label>
            <input
              type="date"
              value={on}
              max={todayISO()}
              onChange={(e) => e.target.value && setOn(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Latest" value={latest != null ? `${latest}` : '—'} />
        <Stat
          label="Change"
          value={
            change != null
              ? `${change > 0 ? '+' : ''}${Math.round(change * 10) / 10}`
              : '—'
          }
        />
        <Stat
          label={type === 'weight' ? 'BMI' : 'Goal'}
          value={
            type === 'weight'
              ? bmiVal != null
                ? bmiVal.toFixed(1)
                : '—'
              : profile?.goal_weight_lb
                ? String(profile.goal_weight_lb)
                : '—'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {mLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              {chartData.length < 2 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Log a few entries to see your trend.
                </p>
              ) : (
                <LineChartSvg
                  data={chartData}
                  xKey="date"
                  series={[
                    { key: 'value', color: GRAY, strokeWidth: 1, dotRadius: 2, name: 'Logged' },
                    { key: 'trend', color: GREEN, strokeWidth: 2.5, name: '7-day trend' },
                  ]}
                />
              )}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Faint line = daily logs · bold = 7-day average (the real trend)
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {(rows ?? []).length > 0 && (
        <Card className="divide-y divide-border overflow-hidden">
          {[...(rows ?? [])]
            .reverse()
            .slice(0, 10)
            .map((r) => (
              <MeasurementRow
                key={r.id}
                row={r}
                onChangeDate={(measured_on) =>
                  updM.mutate({ id: r.id, measured_on })
                }
                onDelete={() => delM.mutate(r.id)}
              />
            ))}
        </Card>
      )}
    </>
  )
}

function MeasurementRow({
  row,
  onChangeDate,
  onDelete,
}: {
  row: Measurement
  onChangeDate: (date: string) => void
  onDelete: () => void
}) {
  const dateInput = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.click()
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 p-3 text-sm">
      <span className="relative">
        <button
          onClick={openPicker}
          className="text-muted-foreground underline decoration-dotted underline-offset-2 active:text-foreground"
          aria-label="Change date"
        >
          {row.measured_on}
        </button>
        <input
          ref={dateInput}
          type="date"
          value={row.measured_on}
          max={todayISO()}
          onChange={(e) => {
            if (e.target.value && e.target.value !== row.measured_on)
              onChangeDate(e.target.value)
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      </span>
      <span className="flex-1 text-right font-medium">
        {row.value} {row.unit}
      </span>
      <button
        onClick={onDelete}
        className="px-2 text-muted-foreground active:text-destructive"
        aria-label="Delete"
      >
        ✕
      </button>
    </div>
  )
}

const MACROS: { key: 'protein' | 'carb' | 'fat'; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carb', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
]

function NutritionView() {
  const [days, setDays] = useState(30)
  const { data: profile } = useProfile()
  const { data: weight } = useLatestWeight()
  const { data: trends, isLoading: tLoading } = useNutritionTrends(days)

  const goal = profile ? resolveCalorieGoal(profile, weight ?? null).goal : null
  const macros =
    goal != null && profile
      ? resolveMacroTargets(goal, weight ?? null, profile.macro_targets)
      : null

  const rows = trends ?? []
  const today = todayISO()
  // Pin each day to the goal that was in effect then (today/future = live), so a
  // range spanning a goal change compares against the right target per day.
  const barRows = rows.map((d) => ({
    ...d,
    goal: goalForDate(profile?.calorie_goal_history, d.date, goal, today),
  }))
  const logged = barRows.filter((d) => d.logged)
  const loggedCount = logged.length
  const avgKcal = loggedCount
    ? Math.round(logged.reduce((s, d) => s + d.kcal, 0) / loggedCount)
    : null
  const loggedGoals = logged
    .map((d) => d.goal)
    .filter((g): g is number => g != null)
  const avgGoal = loggedGoals.length
    ? Math.round(loggedGoals.reduce((s, g) => s + g, 0) / loggedGoals.length)
    : null
  const avgVsGoal = avgKcal != null && avgGoal != null ? avgKcal - avgGoal : null
  const avgMacro = (k: 'protein' | 'carb' | 'fat') =>
    loggedCount
      ? Math.round(logged.reduce((s, d) => s + d[k], 0) / loggedCount)
      : 0

  return (
    <>
      <RangeToggle days={days} onChange={setDays} />

      {tLoading ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Calories</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        </>
      ) : loggedCount === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-muted-foreground">
            Log a few days to see your nutrition trends.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="Avg cal/day"
              value={avgKcal != null ? avgKcal.toLocaleString() : '—'}
            />
            <Stat label="Days logged" value={`${loggedCount}/${days}`} />
            <Stat
              label="Avg vs goal"
              value={
                avgVsGoal != null
                  ? avgVsGoal === 0
                    ? '0'
                    : `${avgVsGoal > 0 ? '+' : '−'}${Math.abs(avgVsGoal)}`
                  : '—'
              }
              className={
                avgVsGoal == null || avgVsGoal === 0
                  ? undefined
                  : avgVsGoal > 0
                    ? 'text-destructive'
                    : 'text-primary'
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Calories</CardTitle>
            </CardHeader>
            <CardContent>
              <CalorieBars data={barRows} />
              {goal != null ? (
                <div className="mt-2 flex justify-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: RING_GREEN }}
                    />
                    under goal
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: RING_OVER }}
                    />
                    over goal
                  </span>
                  <span>gap = not logged</span>
                </div>
              ) : (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Set a calorie goal in your profile to compare against.
                </p>
              )}
            </CardContent>
          </Card>

          {macros && (
            <Card>
              <CardHeader>
                <CardTitle>Avg macros</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
                {MACROS.map((m) => (
                  <MacroBar
                    key={m.key}
                    label={m.label}
                    have={avgMacro(m.key)}
                    target={macros[m.key].grams}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          <MicronutrientCard days={days} />

          <TopSourcesCard days={days} />
        </>
      )}
    </>
  )
}

function MicronutrientCard({ days }: { days: number }) {
  const { dailyMicros, supplements } = useDailySupplements()
  const { data } = useMicronutrientTrends(days, dailyMicros)
  const [showAll, setShowAll] = useState(false)
  if (!data || data.loggedCount === 0) return null

  const low = data.stats.filter((s) => s.direction === 'floor' && s.flagged)
  const over = data.stats.filter((s) => s.direction === 'limit' && s.flagged)
  const shown = showAll ? data.stats : [...low, ...over]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Micronutrients</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {low.length > 0 ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Low this week: </span>
            {low.slice(0, 4).map((s) => s.label).join(', ')}
            {low.length > 4 && ` +${low.length - 4} more`}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You’re on track with your micronutrient targets this week.
          </p>
        )}
        {over.length > 0 && (
          <p className="text-sm">
            <span className="text-muted-foreground">Over on: </span>
            {over.map((s) => s.label).join(', ')}
          </p>
        )}

        {shown.length > 0 && (
          <div className="space-y-2">
            {shown.map((s) => (
              <MicroBar key={s.key} stat={s} />
            ))}
          </div>
        )}

        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-primary"
        >
          {showAll ? 'Show less' : `Show all ${data.stats.length}`}
        </button>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Targets are FDA Daily Values, averaged over your logged days. Foods
          without micronutrient data count as 0, so amounts can read low.
          {supplements.length > 0 && (
            <>
              {' '}
              Includes your daily{' '}
              {supplements.map((s) => s.food.name).join(', ')} on every logged
              day.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}

function MicroBar({ stat }: { stat: MicroStat }) {
  const width = Math.min(100, stat.pctDV)
  const color = stat.flagged ? RING_OVER : RING_GREEN
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-xs">
        <span className="text-foreground">{stat.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {stat.avgPerDay.toLocaleString()}
          {stat.unit} · {stat.pctDV}% DV
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  )
}

const ENERGY_MACRO_KEYS: NutrientKey[] = ['kcal', 'protein', 'carb', 'fat']
const MICRO_KEYS: NutrientKey[] = NUTRIENTS.map((n) => n.key).filter(
  (k) => !ENERGY_MACRO_KEYS.includes(k),
)
const SOURCE_TOP_N = 7

/** Format an average-per-day amount: whole numbers (with thousands separators
 *  for large values like calories), keeping sub-1 traces non-zero. */
function fmtAmount(n: number, unit: string): string {
  const s = formatNutrient(n)
  const num = Number(s)
  return `${num >= 1000 ? num.toLocaleString() : s}${unit}`
}

function TopSourcesCard({ days }: { days: number }) {
  const { data } = useNutrientSources(days)
  const [key, setKey] = useState<NutrientKey>('protein')
  if (!data || data.loggedCount === 0) return null

  const def = NUTRIENT_BY_KEY[key]
  const name = def.label.toLowerCase()
  const list = data.byNutrient[key] ?? []
  const shown = list.slice(0, SOURCE_TOP_N)
  const rest = list.slice(SOURCE_TOP_N)
  const restAmount = rest.reduce((s, c) => s + c.amount, 0)
  const restPct = rest.reduce((s, c) => s + c.pct, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top sources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={key}
          onChange={(e) => setKey(e.target.value as NutrientKey)}
        >
          <optgroup label="Energy & macros">
            {ENERGY_MACRO_KEYS.map((k) => (
              <option key={k} value={k}>
                {NUTRIENT_BY_KEY[k].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Micronutrients">
            {MICRO_KEYS.map((k) => (
              <option key={k} value={k}>
                {NUTRIENT_BY_KEY[k].label}
              </option>
            ))}
          </optgroup>
        </Select>

        {list.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No foods logged with {name} data in this range.
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map((c) => (
              <SourceBar
                key={c.id}
                name={c.name}
                amount={c.amount}
                pct={c.pct}
                unit={def.unit}
              />
            ))}
            {rest.length > 0 && (
              <SourceBar
                name="Other foods"
                amount={restAmount}
                pct={restPct}
                unit={def.unit}
                muted
              />
            )}
          </div>
        )}

        <p className="text-[11px] leading-snug text-muted-foreground">
          Average per logged day · share of your {name}. Foods without {name}{' '}
          data count as 0.
        </p>
      </CardContent>
    </Card>
  )
}

function SourceBar({
  name,
  amount,
  pct,
  unit,
  muted,
}: {
  name: string
  amount: number
  pct: number
  unit: string
  muted?: boolean
}) {
  const width = Math.min(100, Math.round(pct))
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
        <span
          className={cn(
            'min-w-0 truncate',
            muted ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {name}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {fmtAmount(amount, unit)} · {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: muted ? GRAY : RING_GREEN }}
        />
      </div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
            value === o.value
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function RangeToggle({
  days,
  onChange,
}: {
  days: number
  onChange: (d: number) => void
}) {
  return (
    <div className="flex gap-2">
      {[7, 30].map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            'rounded-lg border px-4 py-1.5 text-sm font-medium',
            days === d
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border text-muted-foreground',
          )}
        >
          {d} days
        </button>
      ))}
    </div>
  )
}

function MacroBar({
  label,
  have,
  target,
}: {
  label: string
  have: number
  target: number
}) {
  const pct = target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 0
  return (
    <div className="text-center">
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: RING_GREEN }}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {have}/{target}g
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <Card className="p-3 text-center">
      <div className={cn('text-lg font-bold', className)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  )
}
