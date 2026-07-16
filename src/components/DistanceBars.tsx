import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { RING_GREEN } from '@/components/CalorieRing'
import { dateLabel } from '@/lib/date'
import { cn } from '@/lib/utils'
import type { DistanceBin } from '@/features/insights/useDistanceTrends'

const AXIS = '#9ca3af'
const PAD = { top: 10, right: 8, bottom: 22, left: 30 }

/** Track the container's pixel width (same approach as CalorieBars). */
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

function md(iso: string): string {
  const [, mm, dd] = iso.split('-')
  return `${Number(mm)}/${Number(dd)}`
}

const fmt = (mi: number) => (Math.round(mi * 10) / 10).toString()

/** Round the mile axis up to a clean top, with a step scaled to the range. */
function niceMaxMi(v: number): { top: number; step: number } {
  if (v <= 0) return { top: 1, step: 1 }
  const step = v > 20 ? 5 : v > 8 ? 2 : v > 3 ? 1 : 0.5
  return { top: Math.ceil(v / step) * step, step }
}

/**
 * Dependency-free distance bar chart (hand-rolled SVG, like CalorieBars — no
 * chart lib, per the recharts-prod-crash rule). One bar per day (short range)
 * or per week (long range); tap a bar to read its distance.
 */
export function DistanceBars({
  bins,
  height = 168,
  className,
}: {
  bins: DistanceBin[]
  height?: number
  className?: string
}) {
  const { ref, w } = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const n = bins.length
  const maxMi = bins.reduce((m, b) => Math.max(m, b.miles), 0)
  const { top, step } = niceMaxMi(maxMi * 1.1)

  const pw = Math.max(0, w - PAD.left - PAD.right)
  const ph = Math.max(0, height - PAD.top - PAD.bottom)
  const base = PAD.top + ph
  const slot = n > 0 ? pw / n : pw
  const barW = slot * 0.6
  const yAt = (v: number) => PAD.top + (1 - v / top) * ph
  const xAt = (i: number) => PAD.left + i * slot + (slot - barW) / 2

  const ticks: number[] = []
  for (let v = step; v < top - 1e-9; v += step) ticks.push(Math.round(v * 10) / 10)

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 44))))

  const weekly = bins.some((b) => b.end !== b.start)
  const label = (b: DistanceBin) =>
    weekly ? `${md(b.start)}–${md(b.end)}` : dateLabel(b.start)

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
                  {t}
                </text>
              </g>
            )
          })}

          {bins.map((b, i) =>
            b.miles > 0 ? (
              <rect
                key={b.start}
                x={xAt(i)}
                y={yAt(b.miles)}
                width={barW}
                height={Math.max(1, base - yAt(b.miles))}
                rx={1.5}
                fill={RING_GREEN}
                opacity={active == null || active === i ? 1 : 0.5}
              />
            ) : null,
          )}

          {bins.map((b, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={`x-${b.start}`}
                x={PAD.left + i * slot + slot / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill={AXIS}
              >
                {md(b.start)}
              </text>
            ) : null,
          )}
        </svg>
      )}

      {active != null && bins[active] && bins[active].miles > 0 && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(xAt(active) - 40, 0), Math.max(0, w - 110)),
          }}
        >
          <div className="font-medium">{label(bins[active])}</div>
          <div className="text-muted-foreground">{fmt(bins[active].miles)} mi</div>
        </div>
      )}
    </div>
  )
}
