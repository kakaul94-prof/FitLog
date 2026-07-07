import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Target } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useStrengthGoalsOverview,
  type GoalOverview,
} from '@/features/strength/useStrengthGoals'
import {
  requiredPace,
  formatPace,
  formatGoalTarget,
  PROGRESSION_LABEL,
  type Suggestion,
} from '@/lib/progression'
import { dateLabel, daysBetweenISO, todayISO } from '@/lib/date'

// A compact next-session line. linear/double already read as "S × R @ W"; for
// 5/3/1 the headline is just "Week N of 4", so surface the top working set
// (heaviest, the AMRAP) instead — a weight is more useful at a glance.
function nextLabel(sug: Suggestion): string {
  if (sug.action === 'start' || !sug.sets.length) return ''
  if (sug.method === '531') {
    const top = sug.sets[sug.sets.length - 1]
    return `${top.weightLb} lb × ${top.reps}${top.amrap ? '+' : ''}`
  }
  return sug.headline
}

export function GoalsOverviewPage() {
  const nav = useNavigate()
  const { data, isLoading } = useStrengthGoalsOverview()
  const rows = data ?? []
  // Reached goals sink to the bottom; among the rest, closest-to-target first.
  const sorted = [...rows].sort((a, b) =>
    a.reached !== b.reached ? (a.reached ? 1 : -1) : b.pct - a.pct,
  )

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Strength goals"
        subtitle={rows.length ? `${rows.length} ${rows.length === 1 ? 'goal' : 'goals'}` : undefined}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <Card className="p-6 text-center">
            <Target className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No strength goals yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open an exercise’s page and tap “Set a strength goal” to track
              progress toward a target 1RM.
            </p>
          </Card>
        ) : (
          sorted.map((r) => (
            <GoalRow
              key={r.goal.id}
              r={r}
              onOpen={() => nav(`/lift/exercise/${r.goal.exercise_key}`)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function GoalRow({ r, onOpen }: { r: GoalOverview; onOpen: () => void }) {
  const { goal, current, pct, reached, sug } = r
  const pace = goal.target_date
    ? requiredPace(
        current,
        goal.target_1rm_lb,
        daysBetweenISO(todayISO(), goal.target_date),
      )
    : null
  const next = nextLabel(sug)

  return (
    <Card
      onClick={onOpen}
      className="cursor-pointer p-3 transition-colors active:bg-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{goal.exercise_name}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {PROGRESSION_LABEL[goal.method]}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {current ? `Now ~${current} lb` : 'No history yet'}
        </span>
        <span className="font-medium">Goal {formatGoalTarget(goal)}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={cn(reached && 'font-medium text-primary')}>
          {reached ? '🎉 Reached' : `${pct}%`}
        </span>
        {!reached && pace && (
          <span className={cn(pace.overdue && 'text-destructive')}>
            {pace.overdue
              ? `Past ${dateLabel(goal.target_date!)}`
              : `By ${dateLabel(goal.target_date!)} · +${formatPace(pace.neededPerWeek)}/wk`}
          </span>
        )}
      </div>

      {!reached && next && (
        <div className="mt-1 text-xs text-muted-foreground">Next: {next}</div>
      )}
    </Card>
  )
}
