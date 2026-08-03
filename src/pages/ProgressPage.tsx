import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, Pencil } from 'lucide-react'
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
import {
  useWeightSyncStatus,
  useConnectWeightSync,
  useSyncWeightsNow,
} from '@/features/measurements/useWeightSync'
import type { Measurement } from '@/lib/database.types'
import { useProfile } from '@/features/profile/useProfile'
import { useWeeklyCardioGoal } from '@/features/exercise/useWeeklyCardioGoal'
import { useCardioPaceTrends } from '@/features/insights/useCardioPaceTrends'
import { fmtClock } from '@/lib/cardio'
import { zoneColor } from '@/data/zones'
import { useNutritionTrends } from '@/features/insights/useNutritionTrends'
import {
  useMicronutrientTrends,
  type MicroStat,
} from '@/features/insights/useMicronutrientTrends'
import { useNutrientSources } from '@/features/insights/useNutrientSources'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import { NUTRIENT_SOURCES } from '@/data/nutrientSources'
import { NUTRIENT_SYMPTOMS } from '@/data/nutrientSymptoms'
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
import { todayISO, addDaysISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const TYPES = [
  { type: 'weight', label: 'Weight', unit: 'lb' },
  { type: 'body_fat', label: 'Body fat', unit: '%' },
  { type: 'waist', label: 'Waist', unit: 'in' },
  // Flexibility benchmarks. Reaching past the toes is positive, stopping short
  // is negative, so both trend upward as you get more flexible.
  { type: 'sit_reach', label: 'Sit & reach', unit: 'in' },
  { type: 'back_scratch', label: 'Back scratch', unit: 'in' },
]

const ACCENT = 'var(--primary)'
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
      <ThisWeekCard />

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

      <PaceTrendCard />
    </div>
  )
}

// Weekly cardio volume vs. the cardio goal (Mon–today), broken out by intensity.
// Counts every logged entry — diary or programmed workout — and shares its
// rollup with the Program page. The goal itself is edited on /cardio/goal.
function ThisWeekCard() {
  const nav = useNavigate()
  const { goal, summary } = useWeeklyCardioGoal()

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">This week</CardTitle>
          <button
            type="button"
            onClick={() => nav('/cardio/goal')}
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            <Pencil className="h-3 w-3" />
            {goal ? 'Edit goal' : 'Set goal'}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tabular-nums">
            {summary.totalDone}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {goal ? `/ ${summary.totalTarget} min` : 'min'}
          </span>
        </div>
        {goal && (
          <div className="space-y-2 pt-0.5">
            {summary.buckets.map((b) => (
              <div key={b.key}>
                <div className="mb-0.5 flex items-baseline justify-between text-xs">
                  <span>
                    {b.label}{' '}
                    <span className="text-muted-foreground">{b.sublabel}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {b.done}
                    {b.target > 0 ? ` / ${b.target}` : ''} min
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${b.target > 0 ? Math.min(100, (b.done / b.target) * 100) : 0}%`,
                      background: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {summary.sessions} {summary.sessions === 1 ? 'session' : 'sessions'}{' '}
          since Monday
          {goal
            ? ` · ${summary.mvpaDone} MVPA min (heavy counts double)`
            : ' · set a goal (150 min moderate is the common guideline)'}
        </p>
      </CardContent>
    </Card>
  )
}

// Aerobic efficiency: pace per session at a fixed HR zone. Getting faster at
// the same heart rate = the base is growing. Needs distance + duration + zone.
function PaceTrendCard() {
  const [zone, setZone] = useState(2)
  const { data: pts, isLoading } = useCardioPaceTrends(zone)
  const delta =
    pts && pts.length >= 2 ? pts[pts.length - 1].pace - pts[0].pace : null
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Pace at zone</CardTitle>
          <span className="text-xs text-muted-foreground">last 90 days</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((z) => {
            const sel = zone === z
            const c = zoneColor(z)
            return (
              <button
                key={z}
                type="button"
                onClick={() => setZone(z)}
                className="rounded-md border py-1.5 text-sm font-medium transition-colors"
                style={{
                  color: c,
                  borderColor: sel ? c : 'transparent',
                  background: `color-mix(in srgb, ${c} ${sel ? 16 : 8}%, transparent)`,
                }}
              >
                Z{z}
              </button>
            )
          })}
        </div>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !pts || pts.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Not enough data yet. Log two or more sessions with distance,
            duration, and Zone {zone} (enter your avg HR when logging) and the
            pace trend appears here.
          </p>
        ) : (
          <>
            <LineChartSvg
              data={pts}
              xKey="date"
              series={[
                {
                  key: 'pace',
                  color: zoneColor(zone),
                  strokeWidth: 2,
                  dotRadius: 3,
                  name: 'min/mi',
                },
              ]}
              height={180}
            />
            <p className="text-xs text-muted-foreground">
              min/mi per session at Zone {zone} — lower is faster.
              {delta != null && Math.abs(delta) >= 0.05 && (
                <span className={delta < 0 ? 'text-success' : undefined}>
                  {' '}
                  {delta < 0 ? 'Faster' : 'Slower'} by{' '}
                  {fmtClock(Math.abs(delta) * 60)} /mi vs. the first session.
                </span>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
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

      {type === 'weight' && <WeightSyncCard />}

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
                    { key: 'trend', color: ACCENT, strokeWidth: 2.5, name: '7-day trend' },
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

// Health Connect weight sync (Android app only). The status probe returns
// 'no_permission' → offer Connect; 'ok' → a quiet status line with a manual
// sync; anything else (web, old APK, no Health Connect app) renders nothing.
function WeightSyncCard() {
  const { data: status } = useWeightSyncStatus()
  const connect = useConnectWeightSync()
  const syncNow = useSyncWeightsNow()

  if (status === 'no_permission') {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Sync weight from Health Connect</p>
            <p className="text-xs text-muted-foreground">
              Weigh-ins your scale app records import automatically.
            </p>
          </div>
          <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (status === 'ok') {
    return (
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Activity className="h-3 w-3" />
          Health Connect weight sync is on
        </span>
        <button
          onClick={() => syncNow.mutate()}
          disabled={syncNow.isPending}
          className="underline decoration-dotted underline-offset-2 active:text-foreground"
        >
          {syncNow.isPending ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    )
  }
  return null
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
      <span className="flex flex-1 items-center justify-end gap-1.5 text-right font-medium">
        {row.source === 'healthconnect' && (
          <Activity
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-label="Synced from Health Connect"
          />
        )}
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
  // range spanning a goal change compares against the right target per day, then
  // add that day's cardio burn — the same `goal + burned` budget the diary ring
  // uses, so a workout day doesn't read as "over" here but under there.
  const barRows = rows.map((d) => {
    const base = goalForDate(profile?.calorie_goal_history, d.date, goal, today)
    return { ...d, goal: base == null ? null : base + d.burned }
  })
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
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  <div className="flex justify-center gap-3">
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
                  {logged.some((d) => d.burned > 0) && (
                    <p className="text-center">
                      Dashed line = goal + cardio burned that day.
                    </p>
                  )}
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

          <NutritionReportCard days={days} />

          <MicronutrientCard days={days} />

          <TopSourcesCard days={days} />
        </>
      )}
    </>
  )
}

/** "Jul 28" — short month/day for the report's date range. */
function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Weekly/Monthly report — the flagged nutrients from the same rollup the
 * Micronutrients bars use, but written out: what's low, what's over, what each
 * can feel like (NUTRIENT_SYMPTOMS), and foods to fix the lows
 * (NUTRIENT_SOURCES). Title follows the 7/30-day range toggle.
 */
function NutritionReportCard({ days }: { days: number }) {
  const { dailyMicros } = useDailySupplements()
  const { data } = useMicronutrientTrends(days, dailyMicros)
  if (!data || data.loggedCount === 0) return null

  const low = data.stats.filter((s) => s.direction === 'floor' && s.flagged)
  const over = data.stats.filter((s) => s.direction === 'limit' && s.flagged)
  const today = todayISO()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{days === 7 ? 'Weekly' : 'Monthly'} report</CardTitle>
        <p className="text-xs text-muted-foreground">
          {shortDate(addDaysISO(today, -(days - 1)))} – {shortDate(today)} ·{' '}
          {data.loggedCount} of {days} days logged
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {low.length === 0 && over.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing flagged — you’re on track with your nutrient targets this{' '}
            {days === 7 ? 'week' : 'month'}.
          </p>
        ) : (
          <>
            {low.length > 0 && (
              <ReportSection title="Running low" stats={low} showFoods />
            )}
            {over.length > 0 && (
              <ReportSection title="Running over" stats={over} />
            )}
          </>
        )}
        <p className="border-t border-border pt-3 text-[11px] leading-snug text-muted-foreground">
          General information, not medical advice. Foods without micronutrient
          data count as 0, so amounts can read low.
        </p>
      </CardContent>
    </Card>
  )
}

function ReportSection({
  title,
  stats,
  showFoods = false,
}: {
  title: string
  stats: MicroStat[]
  showFoods?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{title}</p>
      <ul>
        {stats.map((s) => {
          const foods = showFoods ? NUTRIENT_SOURCES[s.key] : undefined
          return (
            <li key={s.key} className="border-t border-border py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{s.label}</span>
                <span className="text-xs font-medium tabular-nums text-destructive">
                  {s.pctDV}% DV
                </span>
              </div>
              <div className="my-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, s.pctDV)}%`,
                    background: RING_OVER,
                  }}
                />
              </div>
              {NUTRIENT_SYMPTOMS[s.key] && (
                <p className="text-xs leading-snug text-muted-foreground">
                  {NUTRIENT_SYMPTOMS[s.key]}
                </p>
              )}
              {foods && (
                <p className="mt-1 text-xs leading-snug text-muted-foreground/80">
                  Try: {foods.join(', ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
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
          Targets are FDA Daily Values, averaged over your logged days.
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
const SOURCE_TOP_N = 5

/** Format a total amount: whole numbers (with thousands separators for large
 *  values like calories), keeping sub-1 traces non-zero. */
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
          Total over the last {days} days · share of your {name}. Foods without{' '}
          {name} data count as 0.
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
