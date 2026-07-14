import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BodyHeatmap } from '@/components/strength/BodyHeatmap'
import { useMuscleVolume } from '@/features/strength/useMuscleVolume'
import { useProfile } from '@/features/profile/useProfile'
import {
  HEAT_STOPS,
  REGION_LABEL,
  heatColor,
  resolveGoals,
  volumeStatus,
  type RegionId,
} from '@/data/bodyMap'
import { addDaysISO, todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

// The goal tick sits at this fraction of each bar's track; the fill grows toward
// it and spills past it when you're over goal.
const GOAL_MARK = 0.68

export function MuscleVolumePage() {
  const nav = useNavigate()
  const end = todayISO()
  const start = addDaysISO(end, -6)
  const { data, isLoading } = useMuscleVolume(start, end)
  const { data: profile } = useProfile()
  const gender = profile?.sex ?? 'male'
  const goals = resolveGoals(profile?.volume_targets)

  const [view, setView] = useState<'body' | 'bars'>('body')
  const [selected, setSelected] = useState<RegionId | null>(null)

  const caption =
    selected && data
      ? `${REGION_LABEL[selected]} · ${data.byRegion[selected]} / ${goals[selected]} sets/wk · ${volumeStatus(
          data.byRegion[selected],
          goals[selected],
        )}`
      : null

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Muscle volume"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => nav('/lift/volume/goals')}
          >
            Edit goals
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Last 7 days · vs your goals
          </div>
          <div className="inline-flex rounded-md bg-muted p-0.5">
            {(['body', 'bars'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'rounded px-3 py-1 text-sm capitalize',
                  view === v
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground',
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {!profile?.sex && (
          <p className="text-xs text-muted-foreground">
            Showing the male figure —{' '}
            <Link to="/profile" className="text-primary underline">
              set your sex in Profile
            </Link>{' '}
            to match.
          </p>
        )}

        {isLoading || !data ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Loading…
          </Card>
        ) : view === 'body' ? (
          <Card className="p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <BodyHeatmap
                  gender={gender}
                  side="front"
                  values={data.byRegion}
                  goals={goals}
                  selected={selected}
                  onSelect={setSelected}
                />
                <div className="mt-1 text-center text-xs text-muted-foreground">
                  Front
                </div>
              </div>
              <div className="flex-1">
                <BodyHeatmap
                  gender={gender}
                  side="back"
                  values={data.byRegion}
                  goals={goals}
                  selected={selected}
                  onSelect={setSelected}
                />
                <div className="mt-1 text-center text-xs text-muted-foreground">
                  Back
                </div>
              </div>
            </div>
            <Legend />
          </Card>
        ) : (
          <Card className="space-y-2 p-3">
            <div className="text-xs text-muted-foreground">
              Tick = your weekly goal · the bar fills toward it (red = at/over)
            </div>
            {data.bars.map((b) => {
              const goal = goals[b.id]
              const fillPct =
                goal > 0
                  ? Math.min(100, (b.sets / goal) * GOAL_MARK * 100)
                  : Math.min(100, (b.sets / 20) * 100)
              const color = heatColor(b.sets, goal)
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b.id)}
                  className="grid w-full grid-cols-[5.5rem_1fr_2rem] items-center gap-2 py-1 text-left"
                >
                  <span className="text-xs text-muted-foreground">{b.label}</span>
                  <span
                    className={cn(
                      'relative h-5 overflow-hidden rounded bg-muted',
                      selected === b.id && 'ring-2 ring-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded',
                        goal <= 0 && 'bg-muted-foreground/30',
                      )}
                      style={{
                        width: `${fillPct}%`,
                        background: goal > 0 ? color ?? 'transparent' : undefined,
                      }}
                    />
                    {goal > 0 && (
                      <span
                        className="absolute inset-y-0 w-0.5 bg-foreground/50"
                        style={{ left: `${GOAL_MARK * 100}%` }}
                      />
                    )}
                  </span>
                  <span className="text-right text-xs tabular-nums">{b.sets}</span>
                </button>
              )
            })}
          </Card>
        )}

        <Card className="p-3 text-sm">
          {selected && data ? (
            <div className="space-y-2">
              <div>{caption}</div>
              {data.byRegionExercises[selected].length > 0 ? (
                <ul className="space-y-1 border-t border-border pt-2">
                  {data.byRegionExercises[selected].map((e) => (
                    <li
                      key={e.name}
                      className="flex justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground">
                        {e.name}
                      </span>
                      <span className="tabular-nums">
                        {e.sets} set{e.sets === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                  No sets logged for this muscle in the last 7 days.
                </div>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">
              Tap a muscle to see its weekly sets vs goal.
            </span>
          )}
        </Card>

        {data && data.unmapped > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {data.unmapped} set{data.unmapped === 1 ? '' : 's'} from un-mapped
              exercises aren’t shown on the map.
            </summary>
            <ul className="mt-2 space-y-1 pl-1">
              {data.unmappedList.map((u) => (
                <li key={u.name} className="flex justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className="tabular-nums">
                    {u.sets} set{u.sets === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span>vs goal</span>
      <span className="flex flex-col items-center gap-0.5">
        <span className="h-3.5 w-6 rounded-sm border border-border bg-muted" />
        none
      </span>
      {HEAT_STOPS.map((s) => (
        <span key={s.label} className="flex flex-col items-center gap-0.5">
          <span className="h-3.5 w-6 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}
