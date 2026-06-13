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
  volumeStatus,
  type RegionId,
} from '@/data/bodyMap'
import { addDaysISO, todayISO } from '@/lib/date'
import { cn } from '@/lib/utils'

const MAX_SCALE = 22 // bar full-width anchor (sets/week)

export function MuscleVolumePage() {
  const nav = useNavigate()
  const end = todayISO()
  const start = addDaysISO(end, -6)
  const { data, isLoading } = useMuscleVolume(start, end)
  const { data: profile } = useProfile()
  const gender = profile?.sex ?? 'male'

  const [view, setView] = useState<'body' | 'bars'>('body')
  const [selected, setSelected] = useState<RegionId | null>(null)

  const caption =
    selected && data
      ? `${REGION_LABEL[selected]} · ${data.byRegion[selected]} sets/wk · ${volumeStatus(
          data.byRegion[selected],
        )}`
      : null

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Muscle volume"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/strength')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Last 7 days · sets per muscle
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
              Green band = 10–20 sets (in range)
            </div>
            {data.bars.map((b) => (
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
                    className="absolute inset-y-0 bg-primary/15"
                    style={{ left: '45%', width: '46%' }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${Math.min(100, (b.sets / MAX_SCALE) * 100)}%`,
                      background: heatColor(b.sets) ?? 'transparent',
                    }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums">{b.sets}</span>
              </button>
            ))}
          </Card>
        )}

        <Card className="p-3 text-sm">
          {caption ?? (
            <span className="text-muted-foreground">
              Tap a muscle to see its weekly sets.
            </span>
          )}
        </Card>

        {data && data.unmapped > 0 && (
          <p className="text-xs text-muted-foreground">
            {data.unmapped} set{data.unmapped === 1 ? '' : 's'} from un-mapped
            exercises aren’t shown on the map.
          </p>
        )}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span>Sets/wk</span>
      <span className="flex flex-col items-center gap-0.5">
        <span className="h-3.5 w-6 rounded-sm border border-border bg-muted" />0
      </span>
      {HEAT_STOPS.map((s) => (
        <span key={s.label} className="flex flex-col items-center gap-0.5">
          <span className="h-3.5 w-6 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
      <span className="ml-auto">11–20 ≈ in range</span>
    </div>
  )
}
