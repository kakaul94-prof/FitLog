import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

export interface ChartSeries {
  /** Key into each data row holding this series' numeric value. */
  key: string
  color: string
  strokeWidth?: number
  /** Dot radius; omit/0 for no dots. */
  dotRadius?: number
  /** Label shown in the hover tooltip. */
  name?: string
}

/** A horizontal reference line (e.g. a goal target) drawn across the chart. */
export interface RefLine {
  value: number
  color: string
  /** Short label drawn at the line's right end. */
  label?: string
  /** Dashed by default; pass false for a solid line. */
  dashed?: boolean
}

interface LineChartSvgProps {
  data: Array<Record<string, string | number>>
  /** Key into each data row holding the x-axis label. */
  xKey: string
  series: ChartSeries[]
  /** Optional horizontal line folded into the y-domain so it's always visible. */
  refLine?: RefLine
  height?: number
  className?: string
}

const AXIS = '#9ca3af'
const PAD = { top: 8, right: 10, bottom: 22, left: 36 }

/** Round a span up to a "nice" 1/2/5 × 10ⁿ number (Heckbert's algorithm). */
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range))
  const frac = range / 10 ** exp
  let nf: number
  if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10
  else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return nf * 10 ** exp
}

/** Nice axis domain + evenly spaced tick values covering [min, max]. */
function niceScale(min: number, max: number, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  const step = niceNum(niceNum(max - min, false) / (count - 1), true)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { lo, hi, ticks }
}

/** Track the container's pixel width (replaces recharts' ResponsiveContainer). */
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

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * Minimal dependency-free line chart (1–2 series) rendered as plain SVG.
 * Replaces recharts here, which crashed (`t is not a function`) inside its
 * LineChart in the minified production bundle.
 */
export function LineChartSvg({
  data,
  xKey,
  series,
  refLine,
  height = 224,
  className,
}: LineChartSvgProps) {
  const { ref, w } = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const n = data.length
  let mn = Infinity
  let mx = -Infinity
  for (const row of data) {
    for (const s of series) {
      const v = Number(row[s.key])
      if (Number.isFinite(v)) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
  }
  if (refLine && Number.isFinite(refLine.value)) {
    if (refLine.value < mn) mn = refLine.value
    if (refLine.value > mx) mx = refLine.value
  }
  const { lo, hi, ticks } = niceScale(mn, mx)

  const pw = Math.max(0, w - PAD.left - PAD.right)
  const ph = Math.max(0, height - PAD.top - PAD.bottom)
  const xAt = (i: number) => PAD.left + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw)
  const yAt = (v: number) =>
    PAD.top + (hi === lo ? ph / 2 : (1 - (v - lo) / (hi - lo)) * ph)

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 48))))

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const i = Math.round(((e.clientX - rect.left - PAD.left) / (pw || 1)) * (n - 1))
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
            if (y < PAD.top - 0.5 || y > height - PAD.bottom + 0.5) return null
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={w - PAD.right}
                  y2={y}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 6}
                  y={y}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill={AXIS}
                >
                  {fmt(t)}
                </text>
              </g>
            )
          })}

          {data.map((d, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={i}
                x={xAt(i)}
                y={height - 6}
                textAnchor="middle"
                fontSize={11}
                fill={AXIS}
              >
                {String(d[xKey])}
              </text>
            ) : null,
          )}

          {series.map((s) => (
            <polyline
              key={s.key}
              points={data.map((d, i) => `${xAt(i)},${yAt(Number(d[s.key]))}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.strokeWidth ?? 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {series.map((s) =>
            s.dotRadius
              ? data.map((d, i) => (
                  <circle
                    key={`${s.key}-${i}`}
                    cx={xAt(i)}
                    cy={yAt(Number(d[s.key]))}
                    r={s.dotRadius}
                    fill={s.color}
                  />
                ))
              : null,
          )}

          {refLine && Number.isFinite(refLine.value) && (
            <g>
              <line
                x1={PAD.left}
                y1={yAt(refLine.value)}
                x2={w - PAD.right}
                y2={yAt(refLine.value)}
                stroke={refLine.color}
                strokeWidth={1.5}
                strokeDasharray={refLine.dashed === false ? undefined : '5 3'}
              />
              {refLine.label && (
                <text
                  x={w - PAD.right}
                  y={
                    yAt(refLine.value) < PAD.top + 14
                      ? yAt(refLine.value) + 14
                      : yAt(refLine.value) - 4
                  }
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={500}
                  fill={refLine.color}
                >
                  {refLine.label}
                </text>
              )}
            </g>
          )}

          {active != null && data[active] && (
            <>
              <line
                x1={xAt(active)}
                y1={PAD.top}
                x2={xAt(active)}
                y2={height - PAD.bottom}
                stroke={AXIS}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={xAt(active)}
                  cy={yAt(Number(data[active][s.key]))}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
              ))}
            </>
          )}
        </svg>
      )}

      {active != null && data[active] && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-md"
          style={{ left: Math.min(Math.max(xAt(active) - 44, 0), Math.max(0, w - 100)) }}
        >
          <div className="font-medium">{String(data[active][xKey])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-muted-foreground">{s.name ?? s.key}:</span>
              <span className="font-medium">{fmt(Number(data[active][s.key]))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
