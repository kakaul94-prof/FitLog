import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Minus, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useProfile, useUpdateProfile } from '@/features/profile/useProfile'
import { useWeeklyCardioGoal } from '@/features/exercise/useWeeklyCardioGoal'
import {
  DEFAULT_CARDIO_GOAL,
  cardioGoalMvpa,
  cardioGoalTotal,
  clampGoalMinutes,
  mvpaVerdict,
} from '@/lib/cardioGoal'
import { HR_ZONE_BANDS } from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import type { CardioGoal, CardioGoalMode } from '@/lib/database.types'
import { cn } from '@/lib/utils'

const STEP = 5

/** Set weekly cardio minutes per intensity. Reached from the Program page and
 *  from Progress → Cardio; both read the saved goal through useWeeklyCardioGoal. */
export function CardioGoalPage() {
  const nav = useNavigate()
  const { data: profile } = useProfile()
  const update = useUpdateProfile()
  const { goal: saved, summary } = useWeeklyCardioGoal()

  const [draft, setDraft] = useState<CardioGoal | null>(null)
  const goal = draft ?? saved ?? DEFAULT_CARDIO_GOAL
  // With no goal saved yet there's always something to create, so Save stays
  // enabled even if the suggested defaults are accepted untouched.
  const dirty =
    saved == null ||
    (draft != null && JSON.stringify(draft) !== JSON.stringify(saved))

  const setMode = (mode: CardioGoalMode) => setDraft({ ...goal, mode })
  const setSimple = (key: 'light' | 'heavy', v: number) =>
    setDraft({ ...goal, [key]: clampGoalMinutes(v) })
  const setZone = (i: number, v: number) =>
    setDraft({
      ...goal,
      zones: goal.zones.map((z, k) => (k === i ? clampGoalMinutes(v) : z)),
    })

  const total = cardioGoalTotal(goal)
  const verdict = mvpaVerdict(cardioGoalMvpa(goal))

  const onSave = () =>
    update.mutate({ cardio_goal: goal }, { onSuccess: () => nav(-1) })

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Cardio goal"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button size="sm" onClick={onSave} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex rounded-xl bg-muted p-1">
          {(
            [
              { value: 'simple', label: 'Light / heavy' },
              { value: 'zones', label: 'Zones 1–5' },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              onClick={() => setMode(o.value)}
              className={cn(
                'flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors',
                goal.mode === o.value
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        {profile === undefined ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Loading…
          </Card>
        ) : (
          <Card className="p-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Minutes per week
            </div>
            <div className="divide-y divide-border">
              {goal.mode === 'simple' ? (
                <>
                  <GoalRow
                    label="Light"
                    sublabel="zones 1–2 · can hold a conversation"
                    color={zoneColor(2)}
                    value={goal.light}
                    onChange={(v) => setSimple('light', v)}
                  />
                  <GoalRow
                    label="Heavy"
                    sublabel="zones 3–5 · a few words at most"
                    color={zoneColor(4)}
                    value={goal.heavy}
                    onChange={(v) => setSimple('heavy', v)}
                  />
                </>
              ) : (
                HR_ZONE_BANDS.map((b, i) => (
                  <GoalRow
                    key={b.zone}
                    label={`Zone ${b.zone}`}
                    sublabel={b.name.toLowerCase()}
                    color={zoneColor(b.zone)}
                    value={goal.zones[i]}
                    onChange={(v) => setZone(i, v)}
                  />
                ))
              )}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              {total} min/week total ·{' '}
              <span className={verdict.ok ? 'text-success' : undefined}>
                {verdict.text}
              </span>
            </p>
          </Card>
        )}

        <Card className="p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This week so far
          </div>
          {summary.totalDone === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              No cardio logged since Monday.
            </p>
          ) : (
            <div className="space-y-2">
              {summary.buckets.map((b) => (
                <div key={b.key}>
                  <div className="mb-0.5 flex items-baseline justify-between text-xs">
                    <span>{b.label}</span>
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
        </Card>

        <p className="px-1 text-xs leading-snug text-muted-foreground">
          Counts every cardio entry logged Mon–Sun, whether you add it in the
          diary or log it from a programmed workout. Sessions without a heart
          rate have no zone, so they count as light.
        </p>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setDraft({ ...DEFAULT_CARDIO_GOAL, mode: goal.mode })}
          >
            Reset to defaults
          </button>
          {update.isError && (
            <span className="text-xs text-destructive">Couldn’t save</span>
          )}
        </div>
      </div>
    </div>
  )
}

function GoalRow({
  label,
  sublabel,
  color,
  value,
  onChange,
}: {
  label: string
  sublabel: string
  color: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{sublabel}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(value - STEP)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          aria-label={`${label} weekly minutes goal`}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="h-8 w-14 rounded-md border border-input bg-background text-center text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + STEP)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
