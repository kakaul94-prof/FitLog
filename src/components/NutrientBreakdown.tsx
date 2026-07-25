import { useState, type ReactNode } from 'react'
import { NUTRIENT_BY_KEY, formatNutrient } from '@/lib/nutrients'
import type { NutrientKey, Nutrients } from '@/lib/database.types'
import { cn } from '@/lib/utils'

export const SECTIONS: {
  title: string | null
  keys: NutrientKey[]
  indent?: NutrientKey[]
}[] = [
  {
    title: null,
    keys: [
      'kcal',
      'protein',
      'carb',
      'fiber',
      'sugar',
      'added_sugar',
      'fat',
      'sat_fat',
      'trans_fat',
      'cholesterol',
      'sodium',
    ],
    indent: ['fiber', 'sugar', 'added_sugar', 'sat_fat', 'trans_fat'],
  },
  {
    title: 'Minerals',
    keys: [
      'potassium',
      'calcium',
      'iron',
      'magnesium',
      'phosphorus',
      'zinc',
      'copper',
      'manganese',
      'selenium',
    ],
  },
  {
    title: 'Vitamins',
    keys: [
      'vit_a',
      'vit_c',
      'vit_d',
      'vit_e',
      'vit_k',
      'b1',
      'b2',
      'b3',
      'b6',
      'folate',
      'b12',
    ],
  },
]

const MACRO_COLORS: Record<'protein' | 'carb' | 'fat', string> = {
  protein: 'var(--primary)',
  carb: '#0d9488',
  fat: '#f59e0b',
}

const DONUT_SIZE = 112
const DONUT_RI = 34
const DONUT_RO = 52

function pointOnCircle(center: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180
  return `${(center + r * Math.cos(a)).toFixed(2)} ${(center + r * Math.sin(a)).toFixed(2)}`
}

/**
 * Macro donut — replaces recharts <PieChart>, whose prod bundle crashes (the
 * same reason the line charts moved to LineChartSvg). Slices start at the top
 * and sweep clockwise, with a small gap between them (the old paddingAngle).
 */
function MacroDonut({
  slices,
}: {
  slices: { name: 'protein' | 'carb' | 'fat'; value: number }[]
}) {
  const c = DONUT_SIZE / 2
  const active = slices.filter((s) => s.value > 0)
  const total = active.reduce((sum, s) => sum + s.value, 0)

  let body: ReactNode
  if (active.length === 1) {
    // A single macro is a full ring — a 360° arc can't be a single path.
    body = (
      <path
        fill={MACRO_COLORS[active[0].name]}
        fillRule="evenodd"
        d={
          `M ${pointOnCircle(c, DONUT_RO, -90)} A ${DONUT_RO} ${DONUT_RO} 0 1 1 ${pointOnCircle(c, DONUT_RO, 90)} A ${DONUT_RO} ${DONUT_RO} 0 1 1 ${pointOnCircle(c, DONUT_RO, -90)} Z ` +
          `M ${pointOnCircle(c, DONUT_RI, -90)} A ${DONUT_RI} ${DONUT_RI} 0 1 0 ${pointOnCircle(c, DONUT_RI, 90)} A ${DONUT_RI} ${DONUT_RI} 0 1 0 ${pointOnCircle(c, DONUT_RI, -90)} Z`
        }
      />
    )
  } else {
    const gap = 2 // degrees between slices, mirrors the old paddingAngle
    let angle = -90 // start at top, sweep clockwise
    body = active.map((s) => {
      const sweep = (s.value / total) * 360
      const a0 = angle + gap / 2
      const a1 = angle + sweep - gap / 2
      angle += sweep
      const large = a1 - a0 > 180 ? 1 : 0
      return (
        <path
          key={s.name}
          fill={MACRO_COLORS[s.name]}
          d={`M ${pointOnCircle(c, DONUT_RO, a0)} A ${DONUT_RO} ${DONUT_RO} 0 ${large} 1 ${pointOnCircle(c, DONUT_RO, a1)} L ${pointOnCircle(c, DONUT_RI, a1)} A ${DONUT_RI} ${DONUT_RI} 0 ${large} 0 ${pointOnCircle(c, DONUT_RI, a0)} Z`}
        />
      )
    })
  }

  return (
    <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-full w-full">
      {body}
    </svg>
  )
}

export function MacroPie({ nutrients }: { nutrients: Nutrients }) {
  const [basis, setBasis] = useState<'cal' | 'g'>('cal')
  const hasAny =
    nutrients.protein != null ||
    nutrients.carb != null ||
    nutrients.fat != null
  if (!hasAny) return null

  const p = nutrients.protein ?? 0
  const c = nutrients.carb ?? 0
  const f = nutrients.fat ?? 0
  const cal = { protein: p * 4, carb: c * 4, fat: f * 9 }
  const totalCal = cal.protein + cal.carb + cal.fat
  const totalG = p + c + f
  // Center shows the stored/label calories so it matches the diary + kcal row;
  // slices/percentages stay on calories computed from each macro (Atwater 4/4/9).
  const displayCal = nutrients.kcal ?? totalCal

  const data = (['protein', 'carb', 'fat'] as const).map((k) => ({
    name: k,
    grams: k === 'protein' ? p : k === 'carb' ? c : f,
    value: basis === 'cal' ? cal[k] : k === 'protein' ? p : k === 'carb' ? c : f,
  }))
  const totalForPct = basis === 'cal' ? totalCal : totalG

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex justify-center">
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setBasis('cal')}
            className={cn(
              'rounded px-2 py-1',
              basis === 'cal' && 'bg-primary text-primary-foreground',
            )}
          >
            Calories
          </button>
          <button
            type="button"
            onClick={() => setBasis('g')}
            className={cn(
              'rounded px-2 py-1',
              basis === 'g' && 'bg-primary text-primary-foreground',
            )}
          >
            Grams
          </button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0">
          <MacroDonut slices={data} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold">
              {basis === 'cal'
                ? Math.round(displayCal)
                : formatNutrient(totalG)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {basis === 'cal' ? 'calories' : 'g'}
            </span>
          </div>
        </div>
        <div className="flex-1 space-y-1">
          {data.map((d) => {
            const pct =
              totalForPct > 0 ? Math.round((d.value / totalForPct) * 100) : 0
            return (
              <div key={d.name} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: MACRO_COLORS[d.name] }}
                />
                <span className="flex-1">
                  {d.name === 'carb'
                    ? 'Carbs'
                    : d.name[0].toUpperCase() + d.name.slice(1)}
                </span>
                <span className="font-medium">{formatNutrient(d.grams)} g</span>
                <span className="w-9 text-right text-xs text-muted-foreground">
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function NutrientBreakdown({ nutrients }: { nutrients: Nutrients }) {
  return (
    <div className="space-y-4">
      <MacroPie nutrients={nutrients} />
      {SECTIONS.map((sec, si) => (
        <div key={si}>
          {sec.title && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {sec.title}
            </div>
          )}
          <div className="divide-y divide-border rounded-lg border border-border">
            {sec.keys.map((k) => {
              const def = NUTRIENT_BY_KEY[k]
              const v = nutrients[k]
              const has = typeof v === 'number'
              const dvPct = has && def.dv ? Math.round((v / def.dv) * 100) : null
              const isKcal = k === 'kcal'
              const indented = sec.indent?.includes(k)
              return (
                <div
                  key={k}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-sm',
                    isKcal && 'bg-muted font-semibold',
                  )}
                >
                  <span className={cn(indented && 'pl-4 text-muted-foreground')}>
                    {def.label}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={cn(!has && 'text-muted-foreground')}>
                      {has ? `${formatNutrient(v)} ${def.unit}` : '—'}
                    </span>
                    {dvPct != null && (
                      <span className="w-10 text-right text-xs text-muted-foreground">
                        {dvPct}%
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        % = share of Daily Value. “—” means the food has no data for that
        nutrient.
      </p>
    </div>
  )
}
