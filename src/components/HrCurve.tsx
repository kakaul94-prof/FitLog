import type { HrZone } from '@/lib/calc'
import { zoneColor } from '@/data/zones'

/**
 * A session's heart-rate trace: zone bands behind, the curve on top. Hand-rolled
 * SVG like every other chart here (no chart lib — see the recharts note in
 * CLAUDE.md). Zeroes are strap dropouts, so the line breaks rather than diving
 * to the floor.
 */
export function HrCurve({
  bpm,
  zones,
  height = 120,
}: {
  bpm: number[]
  zones: HrZone[] | null
  height?: number
}) {
  const real = bpm.filter((b) => b > 0)
  if (real.length < 2) return null

  const W = 300
  const H = height
  const lo = Math.max(0, Math.min(...real) - 5)
  const hi = Math.max(...real) + 5
  const span = Math.max(1, hi - lo)
  const x = (i: number) => (i / Math.max(1, bpm.length - 1)) * W
  const y = (v: number) => H - ((v - lo) / span) * H

  // Break the polyline wherever the strap dropped out.
  const segments: string[] = []
  let cur: string[] = []
  bpm.forEach((b, i) => {
    if (b > 0) cur.push(`${x(i).toFixed(1)},${y(b).toFixed(1)}`)
    else if (cur.length) {
      segments.push(cur.join(' '))
      cur = []
    }
  })
  if (cur.length) segments.push(cur.join(' '))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Heart rate over the session, ${Math.min(
        ...real,
      )} to ${Math.max(...real)} bpm`}
    >
      {zones?.map((z) => {
        // Clip each band to the visible bpm window; skip the ones off-screen.
        const top = Math.min(z.hiBpm, hi)
        const bot = Math.max(z.loBpm, lo)
        if (top <= bot) return null
        return (
          <rect
            key={z.zone}
            x={0}
            y={y(top)}
            width={W}
            height={Math.max(0, y(bot) - y(top))}
            fill={zoneColor(z.zone)}
            opacity={0.12}
          />
        )
      })}
      {segments.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={zoneColor(5)}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}
