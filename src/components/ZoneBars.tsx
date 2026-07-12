import { HR_ZONE_BANDS } from '@/lib/calc'
import { zoneColor } from '@/data/zones'
import type { ZoneMinutes } from '@/features/insights/useCardioZoneTrends'

/**
 * Horizontal time-in-zone bars (hand-rolled — no chart lib, per the
 * recharts-prod-crash rule). Each bar is scaled to the busiest zone; the color
 * matches the zone picker + entry badge.
 */
export function ZoneBars({ data }: { data: ZoneMinutes[] }) {
  const max = Math.max(1, ...data.map((d) => d.minutes))
  return (
    <div className="space-y-2.5">
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
