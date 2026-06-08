import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { NUTRIENT_BY_KEY, formatNutrient } from '@/lib/nutrients'
import type { NutrientKey, Nutrients } from '@/lib/database.types'
import { cn } from '@/lib/utils'

const SECTIONS: {
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
  protein: '#16a34a',
  carb: '#3b82f6',
  fat: '#f59e0b',
}

function MacroPie({ nutrients }: { nutrients: Nutrients }) {
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
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={34}
                outerRadius={52}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={MACRO_COLORS[d.name]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold">
              {basis === 'cal'
                ? Math.round(totalCal)
                : formatNutrient(totalG)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {basis === 'cal' ? 'kcal' : 'g'}
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
