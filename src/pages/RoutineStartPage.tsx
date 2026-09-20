import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Play } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useRoutine,
  useStartFromRoutine,
  useSetExerciseOptional,
} from '@/features/strength/useRoutines'
import { useRoutineMeta } from '@/features/strength/useRoutineMeta'
import { isCardioKey } from '@/lib/cardio'
import {
  ASSUMED_SETS,
  minutesPerSet,
  trimToBudget,
  trimSummary,
  type BudgetItem,
} from '@/lib/timeBudget'
import { todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

/** Minute budgets offered as chips. `null` = the full session. */
const CHIPS: (number | null)[] = [null, 30, 45, 60]

/** "How long do you have?" — pick a time and the template is trimmed to fit
 *  before the workout is created. Reached from the Exercise hero; the plain
 *  Start button still starts the full session in one tap. */
export function RoutineStartPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data } = useRoutine(id)
  const { data: meta } = useRoutineMeta(id)
  const startFrom = useStartFromRoutine()
  const setOptional = useSetExerciseOptional()
  const [budget, setBudget] = useState<number | null>(null)

  const routine = data?.routine
  // Cardio items aren't copied into the workout, so they're not trimmed here.
  const lifts = useMemo(
    () => (data?.exercises ?? []).filter((e) => !isCardioKey(e.exercise_key)),
    [data],
  )

  const items: BudgetItem[] = lifts.map((e) => ({
    id: e.id,
    name: e.exercise_name,
    sets: e.target_sets,
    isOptional: !!e.is_optional,
  }))

  // Minutes per set come from the routine's own measured estimate (median of
  // your recent runs), divided by the same set count the trim counts — so a
  // template with no target_sets is read as 3 on both sides.
  const fullSets = items.reduce(
    (s, i) => s + (i.sets && i.sets > 0 ? i.sets : ASSUMED_SETS),
    0,
  )
  const perSet = minutesPerSet(meta?.estMinutes, fullSets)
  const trim = trimToBudget(items, budget, perSet)

  const plan = Object.fromEntries(trim.items.map((i) => [i.id, i.keptSets]))
  const trimmed = !trim.untouched

  const start = async (full: boolean) => {
    if (!routine) return
    const wid = await startFrom.mutateAsync({
      routineId: routine.id,
      name: routine.name,
      date: todayISO(),
      plan: full || !trimmed ? undefined : plan,
    })
    nav(`/workout/${wid}`)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title={routine?.name ?? 'Start workout'}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        <Card className="p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            HOW LONG DO YOU HAVE?
          </p>
          <div className="flex gap-2">
            {CHIPS.map((c) => (
              <button
                key={c ?? 'full'}
                type="button"
                onClick={() => setBudget(c)}
                className={cn(
                  'flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors',
                  budget === c
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary text-foreground',
                )}
              >
                {c ?? 'Full'}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <div>
              <p className="text-2xl font-bold">
                {perSet ? `≈ ${trim.estMinutes} min` : `${trim.totalSets} sets`}
              </p>
              <p className="text-xs text-muted-foreground">
                {trimSummary(trim)}
              </p>
            </div>
            {trimmed && (
              <div className="text-right text-xs text-muted-foreground">
                was ≈ {trim.fullMinutes}
                <br />
                {trim.fullSets} sets
              </div>
            )}
          </div>
          {!perSet && (
            <p className="mt-2 text-xs text-muted-foreground">
              No time estimate for this template yet — run it once and the
              budgets start working.
            </p>
          )}
          {!!meta?.cardioMinutes && (
            <p className="mt-2 text-xs text-muted-foreground">
              Plus ~{meta.cardioMinutes} min of cardio, which isn't trimmed.
            </p>
          )}
        </Card>

        <div className="flex items-center justify-between px-1 text-[11px] text-muted-foreground">
          <span>EXERCISES</span>
          <span>DROPPABLE</span>
        </div>

        <Card className="divide-y divide-border overflow-hidden">
          {trim.items.map((it) => {
            const cut = it.keptSets === 0
            const shaved = it.keptSets > 0 && it.keptSets < it.sets
            return (
              <div key={it.id} className="flex items-center gap-3 p-3">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    cut && 'text-muted-foreground line-through',
                  )}
                >
                  {it.name}
                </span>
                <span
                  className={cn(
                    'w-16 text-right text-xs tabular-nums',
                    cut || shaved
                      ? 'font-semibold text-warning'
                      : 'text-muted-foreground',
                  )}
                >
                  {cut
                    ? 'cut'
                    : shaved
                      ? `${it.sets} → ${it.keptSets}`
                      : `${it.sets} sets`}
                </span>
                <Switch
                  checked={it.isOptional}
                  label={`${it.name} — droppable when short on time`}
                  disabled={setOptional.isPending}
                  onClick={() =>
                    setOptional.mutate({
                      routineId: id!,
                      id: it.id,
                      isOptional: !it.isOptional,
                    })
                  }
                />
              </div>
            )
          })}
          {lifts.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              This template has no lifts to trim.
            </div>
          )}
        </Card>

        <p className="px-1 text-xs text-muted-foreground">
          {trimmed
            ? 'Flip one back to core and it survives the cut. Your rest timer is untouched.'
            : 'Droppable exercises go first when you pick a shorter time. Core lifts are never dropped.'}
        </p>

        {!trim.fits && (
          <p className="px-1 text-xs font-medium text-warning">
            ≈ {trim.estMinutes} min is as short as this template goes — core
            lifts are never dropped.
          </p>
        )}

        {setOptional.isError && (
          <p className="px-1 text-xs text-destructive">
            Couldn't save that — if this is a fresh database, run
            migration_routine_time_budget.sql.
          </p>
        )}

        <Button
          size="lg"
          className="w-full"
          onClick={() => start(false)}
          disabled={startFrom.isPending || !routine}
        >
          <Play className="h-4 w-4" />
          {startFrom.isPending
            ? 'Starting…'
            : trimmed
              ? `Start ${trim.estMinutes} min workout`
              : 'Start workout'}
        </Button>
        {trimmed && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => start(true)}
            disabled={startFrom.isPending}
          >
            Start the full session anyway
          </Button>
        )}
      </div>
    </div>
  )
}
