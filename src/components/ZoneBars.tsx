import { HR_ZONE_BANDS } from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import type { ZoneMinutes } from '@/features/insights/useCardioZoneTrends'

/**
 * Horizontal time-in-zone bars (hand-rolled — no chart lib, per the
 * recharts-prod-crash rule). Each bar is scaled to the busiest row; the color
 * matches the zone picker + entry badge.
 *
 * `below` is minutes recorded under the Zone 1 floor — easy walking, which no
 * zone claims because zones only start at 50% intensity. A single session passes
 * it so 30 minutes of walking can't read as 6 minutes of exercise. It counts
 * toward the scale, so the zoned bars shrink to their honest share. The weekly
 * Progress rollup leaves it out: hand-logged entries have no curve to measure
 * easy time from, so the number would be a half-truth there.
 */
export function ZoneBars({
  data,
  below,
}: {
  data: ZoneMinutes[]
  below?: number
}) {
  const max = Math.max(1, ...data.map((d) => d.minutes), below ?? 0)
  return (
    <div className="space-y-2.5">
      {!!below && (
        <div className="flex items-center gap-3">
          <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
            <span className="truncate text-muted-foreground">Below Z1</span>
          </div>
          <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-muted-foreground/30"
              style={{ width: `${(below / max) * 100}%` }}
            />
          </div>
          <div className="w-14 shrink-0 text-right text-xs text-muted-foreground">
            {below} min
          </div>
        </div>
      )}
      {data.map((d) => {
        const band = HR_ZONE_BANDS[d.zone - 1]
        const c = zoneColor(d.zone)
        return (
          <div key={d.zone} className="flex items-center gap-3">
            <div className="flex w-24 shrink-0 items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: c }}
              />
              <span className="font-medium">Z{d.zone}</span>
              <span className="truncate text-muted-foreground">{band.name}</span>
            </div>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.minutes / max) * 100}%`, background: c }}
              />
            </div>
            <div className="w-14 shrink-0 text-right text-xs text-muted-foreground">
              {d.minutes} min
            </div>
          </div>
        )
      })}
    </div>
  )
}
