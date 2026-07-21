import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { RING_GREEN, RING_OVER } from '@/components/CalorieRing'
import { dateLabel } from '@/lib/date'
import { cn } from '@/lib/utils'

export interface CalorieBar {
  date: string
  kcal: number
  logged: boolean
  // The calorie goal in effect on this day (see goalForDate); null = no goal.
  goal?: number | null
}

const AXIS = '#9ca3af'
const PAD = { top: 10, right: 8, bottom: 22, left: 30 }

/** Track the container's pixel width (same approach as LineChartSvg). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, w }
}

/** Round up to a "nice" axis max so the 1k gridlines land cleanly. */
function niceMax(v: number): number {
  if (v <= 0) return 1000
  const step = v > 4000 ? 1000 : 500
  return Math.ceil(v / step) * step
}

function md(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${Number(mm)}/${Number(dd)}`
}

/**
 * Dependency-free daily-calories bar chart (hand-rolled SVG, like CalorieRing /
 * LineChartSvg — recharts crashes in the prod bundle). Bars are green under that
 * day's goal, red over it; the dashed line steps with the goal history. Unlogged
 * days render as gaps. Tap a bar to read its total.
 */
export function CalorieBars({
  data,
  height = 184,
  className,
}: {
  data: CalorieBar[]
  height?: number
  className?: string
}) {
  const { ref, w } = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const n = data.length
  const maxKcal = data.reduce((m, d) => Math.max(m, d.kcal), 0)
  const maxGoal = data.reduce((m, d) => Math.max(m, d.goal ?? 0), 0)
  const top = niceMax(Math.max(maxGoal, maxKcal) * 1.1)

  const pw = Math.max(0, w - PAD.left - PAD.right)
  const ph = Math.max(0, height - PAD.top - PAD.bottom)
  const base = PAD.top + ph
  const slot = n > 0 ? pw / n : pw
  const barW = slot * 0.6
  const yAt = (v: number) => PAD.top + (1 - v / top) * ph
  const xAt = (i: number) => PAD.left + i * slot + (slot - barW) / 2

  const ticks: number[] = []
  for (let v = 1000; v < top; v += 1000) ticks.push(v)

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 44))))

  // Stepped goal line: each day's goal spans its own slot and steps at the
  // boundary when it changes. One path per contiguous run of days with a goal.
  const goalPaths: string[] = []
  {
    let d = ''
    let prevY: number | null = null
    data.forEach((row, i) => {
      const g = row.goal
      const xa = PAD.left + i * slot
      const xb = PAD.left + (i + 1) * slot
      if (g == null) {
        if (d) goalPaths.push(d)
        d = ''
        prevY = null
        return
      }
      const y = yAt(g)
      if (!d) d = `M ${xa} ${y} L ${xb} ${y}`
      else {
        if (prevY != null && y !== prevY) d += ` L ${xa} ${y}`
        d += ` L ${xb} ${y}`
      }
      prevY = y
    })
    if (d) goalPaths.push(d)
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const i = Math.floor(((e.clientX - rect.left - PAD.left) / (pw || 1)) * n)
    setActive(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <div ref={ref} className={cn('relative', className)} style={{ height }}>
      {w > 0 && (
        <svg
          ref={svgRef}
          width={w}
          height={height}
          className="block touch-pan-y"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => {
            const y = yAt(t)
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={w - PAD.right}
                  y2={y}
                  stroke="var(--border)"
                />
                <text
                  x={PAD.left - 5}
                  y={y}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={10}
                  fill={AXIS}
                >
                  {t / 1000}k
                </text>
              </g>
            )
          })}

          {data.map((d, i) =>
            d.kcal > 0 ? (
              <rect
                key={d.date}
                x={xAt(i)}
                y={yAt(d.kcal)}
                width={barW}
                height={Math.max(1, base - yAt(d.kcal))}
                rx={1.5}
                fill={d.goal != null && d.kcal > d.goal ? RING_OVER : RING_GREEN}
                opacity={active == null || active === i ? 1 : 0.5}
              />
            ) : null,
          )}

          {goalPaths.map((d, i) => (
            <path
              key={`goal-${i}`}
              d={d}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeWidth={1.3}
              strokeDasharray="4 3"
            />
          ))}

          {data.map((d, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={`x-${d.date}`}
                x={PAD.left + i * slot + slot / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill={AXIS}
              >
                {md(d.date)}
              </text>
            ) : null,
          )}
        </svg>
      )}

      {active != null && data[active] && data[active].kcal > 0 && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(xAt(active) - 40, 0), Math.max(0, w - 96)),
          }}
        >
          <div className="font-medium">{dateLabel(data[active].date)}</div>
          <div className="text-muted-foreground">
            {data[active].kcal.toLocaleString()} cal
          </div>
        </div>
      )}
    </div>
  )
}
