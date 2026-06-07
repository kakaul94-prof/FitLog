import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NUTRIENTS, NUTRIENT_BY_KEY } from '@/lib/nutrients'
import type { NutrientKey, Nutrients } from '@/lib/database.types'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const HEADLINE: NutrientKey[] = ['kcal', 'protein', 'carb', 'fat']
const SUB: NutrientKey[] = ['fiber', 'sugar', 'added_sugar', 'sat_fat', 'trans_fat']

function Row({
  k,
  value,
  onChange,
}: {
  k: NutrientKey
  value: Nutrients[NutrientKey]
  onChange: (key: NutrientKey, value: string) => void
}) {
  const def = NUTRIENT_BY_KEY[k]
  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-sm">{def.label}</label>
      <Input
        className="h-9 w-24"
        type="number"
        inputMode="decimal"
        placeholder="0"
        value={value ?? ''}
        onChange={(e) => onChange(k, e.target.value)}
      />
      <span className="w-8 text-xs text-muted-foreground">{def.unit}</span>
    </div>
  )
}

export function NutrientFields({
  values,
  onChange,
}: {
  values: Nutrients
  onChange: (key: NutrientKey, value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const micro = NUTRIENTS.filter(
    (n) => !HEADLINE.includes(n.key) && !SUB.includes(n.key),
  )

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {HEADLINE.map((k) => (
          <Row key={k} k={k} value={values[k]} onChange={onChange} />
        ))}
      </div>
      <div className="space-y-2 border-l-2 border-border pl-3">
        {SUB.map((k) => (
          <Row key={k} k={k} value={values[k]} onChange={onChange} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-sm font-medium"
      >
        Micronutrients (optional)
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-2">
          {micro.map((n) => (
            <Row key={n.key} k={n.key} value={values[n.key]} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}
