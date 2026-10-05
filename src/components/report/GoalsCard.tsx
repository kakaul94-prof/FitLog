import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  CALORIE_BAND,
  type CellTone,
  type GoalStatus,
  type ReportGoal,
  type ReportResult,
} from '@/lib/report'
import { cn } from '@/lib/utils'

const FILL: Record<CellTone, string> = {
  hit: 'bg-success',
  close: 'bg-warning',
  miss: 'bg-destructive',
  done: 'bg-primary',
  none: 'bg-muted-foreground/25',
}

const TEXT: Record<GoalStatus, string> = {
  hit: 'text-success',
  close: 'text-warning',
  miss: 'text-destructive',
}

// The track runs to 120% of the goal so going over stays visible; the goal
// line sits at the same spot on every bar.
const TRACK_MAX = 1.2
const pct = (ratio: number) =>
  `${(Math.min(Math.max(ratio, 0), TRACK_MAX) / TRACK_MAX) * 100}%`

/** "3 of 6 goals met" + the missed / days-logged pills. The collapsed face of
 *  the goals card, and the Progress tab's "Last week" card. */
export function GoalsHeadline({ report }: { report: ReportResult }) {
  return (
    <span className="flex flex-col gap-2">
      <span className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold leading-none tabular-nums">
          {report.met} of {report.goals.length}
        </span>
        <span className="text-sm text-muted-foreground">goals met</span>
      </span>
      <span className="flex flex-wrap gap-1.5 text-xs">
        {report.missed.length > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
            Missed: {report.missed.join(', ').toLowerCase()}
          </span>
        )}
        <span
          className={cn(
            'rounded-full px-2 py-0.5',
            report.lowCoverage
              ? 'bg-warning/15 text-warning'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {report.loggedDays} of {report.coveredDays} days logged
          {report.lowCoverage && ' · averages are rough'}
        </span>
      </span>
    </span>
  )
}

/** Collapsed by default; the page owns `open` so paging between weeks (which
 *  briefly shows a skeleton) doesn't snap it shut. */
export function GoalsCard({
  report,
  open,
  onToggle,
}: {
  report: ReportResult
  open: boolean
  onToggle: () => void
}) {
  const [detail, setDetail] = useState<string | null>(null)
  return (
    <Card>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 p-4 text-left"
      >
        <GoalsHeadline report={report} />
        <ChevronDown
          className={cn(
            'mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <CardContent>
          {report.goals.map((g) => (
            <GoalBar
              key={g.key}
              goal={g}
              open={detail === g.key}
              onToggle={() => setDetail((d) => (d === g.key ? null : g.key))}
            />
          ))}
          <p className="border-t border-border pt-2 text-xs text-muted-foreground">
            The line marks your goal.
            {report.goals.some((g) => g.band) && ' Calories aim for the shaded range.'}
          </p>
        </CardContent>
      )}
    </Card>
  )
}

function GoalBar({
  goal,
  open,
  onToggle,
}: {
  goal: ReportGoal
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="border-t border-border py-2.5">
      <button onClick={onToggle} aria-expanded={open} className="block w-full text-left">
        <span className="flex items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0">
            {goal.label}
            {goal.note && (
              <span className={cn('text-xs', TEXT[goal.status])}> · {goal.note}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 tabular-nums">
            {goal.value}
            <span className="text-xs text-muted-foreground">{goal.target}</span>
            <ChevronDown
              className={cn(
                'h-3 w-3 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </span>
        </span>
        <span className="relative mt-1.5 block h-2 rounded-full bg-muted">
          {goal.band && (
            <span
              className="absolute inset-y-0 bg-success/20"
              style={{
                left: pct(1 - CALORIE_BAND),
                width: `${((2 * CALORIE_BAND) / TRACK_MAX) * 100}%`,
              }}
            />
          )}
          <span
            className={cn('absolute inset-y-0 left-0 rounded-full', FILL[goal.status])}
            style={{ width: pct(goal.ratio) }}
          />
          <span
            className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground/50"
            style={{ left: pct(1) }}
          />
        </span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-muted/60 px-2 py-2">
          <div
            className="grid gap-0.5 text-center text-[11px] tabular-nums"
            style={{ gridTemplateColumns: `repeat(${goal.cells.length}, minmax(0, 1fr))` }}
          >
            {goal.cells.map((c, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <span className={cn('h-3 w-3 rounded-full', FILL[c.tone])} />
                <span>{c.value || ' '}</span>
                <span className="text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{goal.summary}</p>
        </div>
      )}
    </div>
  )
}
