import { zoneColor } from '@/data/zones'
import { cn } from '@/lib/utils'

/**
 * Small pill showing a cardio entry's HR zone (+ optional avg HR). Colored
 * outline + faint tint via color-mix so it reads in light and dark. Renders
 * nothing when there's no zone, so callers can drop it in unconditionally.
 */
export function ZoneBadge({
  zone,
  avgHr,
  className,
}: {
  zone: number | null
  avgHr?: number | null
  className?: string
}) {
  if (!zone) return null
  const c = zoneColor(zone)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        color: c,
        borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
      }}
    >
      Zone {zone}
      {avgHr ? ` · ${avgHr} bpm` : ''}
    </span>
  )
}
