import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Flame, Trophy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { GoalsCard } from '@/components/report/GoalsCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { useStreak } from '@/features/diary/useDiary'
import { useAdaptiveTDEE } from '@/features/insights/useAdaptiveTDEE'
import { analyzeMicros, type MicroRow } from '@/features/insights/useMicronutrientTrends'
import { useDailySupplements } from '@/features/profile/useDailySupplements'
import { useProfile } from '@/features/profile/useProfile'
import { usePeriodPRs, useReportGoals } from '@/features/report/useReport'
import { caloriesForRate } from '@/lib/calc'
import { todayISO } from '@/lib/date'
import {
  canGoForward,
  coveredEnd,
  isCurrentPeriod,
  lastCompletedPeriod,
  onPace,
  periodContaining,
  periodLabel,
  shiftPeriod,
  type ReportKind,
  type ReportPeriod,
} from '@/lib/report'
import { cn } from '@/lib/utils'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** "−0.9" — signed to one decimal with a real minus sign. */
const signed = (n: number) =>
  `${n > 0.05 ? '+' : n < -0.05 ? '−' : ''}${Math.abs(n).toFixed(1)}`

/** Week/Month in review — how the period went against every goal you've set.
 *  `?kind=week|month&start=YYYY-MM-DD`; opens on the last completed week. */
export function ReportPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  const kind: ReportKind = params.get('kind') === 'month' ? 'month' : 'week'
  const startParam = params.get('start')
  let period =
    startParam && ISO_DAY.test(startParam)
      ? periodContaining(kind, startParam)
      : lastCompletedPeriod(kind, today)
  if (period.start > today) period = periodContaining(kind, today)
  const go = (p: ReportPeriod) =>
    setParams({ kind: p.kind, start: p.start }, { replace: true })

  const { report, rows, isLoading, isError } = useReportGoals(period)
  const [goalsOpen, setGoalsOpen] = useState(false)
  const current = isCurrentPeriod(period, today)
  const latest = current || period.start === lastCompletedPeriod(kind, today).start

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={kind === 'week' ? 'Week in review' : 'Month in review'}
        left={
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => nav('/progress')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Previous ${kind}`}
            onClick={() => go(shiftPeriod(period, -1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-semibold">
            {periodLabel(period)}
            {current && <span className="font-normal text-muted-foreground"> · so far</span>}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Next ${kind}`}
            className={cn(!canGoForward(period, today) && 'invisible')}
            onClick={() => go(shiftPeriod(period, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <Segmented
          value={kind}
          onChange={(k) => go(lastCompletedPeriod(k, today))}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />

        {isError ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Couldn't load this {kind}. Check your connection and try again.
          </Card>
        ) : isLoading || !report ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : report.goals.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Set a calorie, cardio, or step goal to see how your {kind} went.
          </Card>
        ) : (
          <GoalsCard
            report={report}
            open={goalsOpen}
            onToggle={() => setGoalsOpen((v) => !v)}
          />
        )}

        <PaceCard end={coveredEnd(period, today)} />
        <Wins period={period} showStreak={latest} />
        {rows && <LowNutrients rows={rows.diary} kind={kind} />}
      </div>
    </div>
  )
}

/** Weight trend vs your goal rate. Not "ate vs maintenance" — maintenance is
 *  back-solved from intake and weight, so that comparison always agrees. */
function PaceCard({ end }: { end: string }) {
  const today = todayISO()
  const { data: tdee } = useAdaptiveTDEE(28, end === today ? undefined : end)
  const { data: profile } = useProfile()
  if (!tdee || !profile) return null
  const rate = profile.goal_rate_lb_per_week ?? 0
  const ready = tdee.enough && tdee.tdee != null && tdee.trendLbPerWeek != null
  const trend = tdee.trendLbPerWeek ?? 0
  const aim = Math.round(((tdee.tdee ?? 0) + caloriesForRate(rate)) / 10) * 10
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">On pace?</span>
        <span className="text-xs text-muted-foreground">28-day trend</span>
      </div>
      {ready ? (
        <>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums',
                onPace(trend, rate) ? 'text-success' : 'text-warning',
              )}
            >
              {signed(trend)}
            </span>
            <span className="text-xs text-muted-foreground">lb/wk · goal {signed(rate)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Measured maintenance is {(tdee.tdee as number).toLocaleString()}.{' '}
            {rate === 0 ? 'To maintain' : `For ${signed(rate)} lb/wk`}, aim for about{' '}
            {aim.toLocaleString()} a day.
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {tdee.reason ?? 'Not enough data yet.'}
        </p>
      )}
    </Card>
  )
}

function Wins({ period, showStreak }: { period: ReportPeriod; showStreak: boolean }) {
  const prs = usePeriodPRs(period)
  const { data: streak = 0 } = useStreak()
  const streakOn = showStreak && streak > 0
  if (!prs.length && !streakOn) return null
  return (
    <div className="flex gap-2">
      {prs.length > 0 && (
        <Card className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm">
          <Trophy className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0">
            <span className="font-medium">
              {prs.length} PR{prs.length > 1 ? 's' : ''}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {prs.map((p) => p.name).join(', ')}
            </span>
          </span>
        </Card>
      )}
      {streakOn && (
        <Card className="flex flex-1 items-center gap-2 px-3 py-2 text-sm">
          <Flame className="h-4 w-4 shrink-0 text-destructive" />
          <span className="font-medium">{streak}-day streak</span>
        </Card>
      )}
    </div>
  )
}

/** Floor nutrients flagged low over the period, linking to the full analysis. */
function LowNutrients({ rows, kind }: { rows: MicroRow[]; kind: ReportKind }) {
  const nav = useNavigate()
  const { dailyMicros } = useDailySupplements()
  const low = analyzeMicros(rows, dailyMicros).stats.filter(
    (s) => s.direction === 'floor' && s.flagged,
  )
  if (!low.length) return null
  const shown = low.slice(0, 3).map((s) => s.label).join(', ')
  return (
    <Card>
      <button
        onClick={() => nav('/progress?view=nutrition')}
        className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm"
      >
        <span>
          <span className="text-muted-foreground">Low this {kind}: </span>
          {shown}
          {low.length > 3 && ` +${low.length - 3} more`}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
      </button>
    </Card>
  )
}
