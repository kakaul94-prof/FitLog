import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Search, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NutrientFields } from '@/components/NutrientFields'
import { useFood, useSaveFood } from '@/features/foods/useFoods'
import {
  searchUsdaFoods,
  getUsdaFood,
  isUsdaConfigured,
  type UsdaSearchItem,
} from '@/lib/usda'
import type { Food, NutrientKey, Nutrients } from '@/lib/database.types'

export function FoodFormPage() {
  const nav = useNavigate()
  const { id } = useParams()
  const { data: existing } = useFood(id)
  const saveFood = useSaveFood()

  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [servingQty, setServingQty] = useState('1')
  const [servingUnit, setServingUnit] = useState('serving')
  const [servingGrams, setServingGrams] = useState('')
  const [source, setSource] = useState<Food['source']>('manual')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [nutrients, setNutrients] = useState<Nutrients>({})

  const [uq, setUq] = useState('')
  const [uResults, setUResults] = useState<UsdaSearchItem[]>([])
  const [uLoading, setULoading] = useState(false)
  const [uErr, setUErr] = useState('')

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setBrand(existing.brand ?? '')
    setServingQty(String(existing.serving_qty))
    setServingUnit(existing.serving_unit)
    setServingGrams(existing.serving_grams != null ? String(existing.serving_grams) : '')
    setSource(existing.source)
    setSourceId(existing.source_id)
    setNutrients(existing.nutrients ?? {})
  }, [existing])

  const setNutrient = (k: NutrientKey, v: string) => {
    setNutrients((prev) => {
      const next = { ...prev }
      const num = parseFloat(v)
      if (v === '' || Number.isNaN(num)) delete next[k]
      else next[k] = num
      return next
    })
  }

  const runUsda = async () => {
    if (!uq.trim()) return
    setULoading(true)
    setUErr('')
    try {
      setUResults(await searchUsdaFoods(uq.trim()))
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setULoading(false)
    }
  }

  const pickUsda = async (item: UsdaSearchItem) => {
    setULoading(true)
    setUErr('')
    try {
      const d = await getUsdaFood(item.fdcId)
      setName(d.name)
      setBrand(d.brand ?? '')
      setServingQty(String(d.serving_qty))
      setServingUnit(d.serving_unit)
      setServingGrams(d.serving_grams != null ? String(d.serving_grams) : '')
      setSource('usda')
      setSourceId(d.source_id)
      setNutrients(d.nutrients)
      setUResults([])
      setUq('')
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setULoading(false)
    }
  }

  const onSave = async () => {
    if (!name.trim()) return
    await saveFood.mutateAsync({
      id,
      name: name.trim(),
      brand: brand.trim() || null,
      source,
      source_id: sourceId,
      serving_qty: parseFloat(servingQty) || 1,
      serving_unit: servingUnit.trim() || 'serving',
      serving_grams: servingGrams ? parseFloat(servingGrams) : null,
      recipe_servings: null,
      nutrients,
    })
    nav('/foods')
  }

  return (
    <div>
      <PageHeader
        title={id ? 'Edit food' : 'Add food'}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/foods')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        {/* USDA search */}
        <Card>
          <CardHeader>
            <CardTitle>Search USDA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!isUsdaConfigured ? (
              <p className="text-sm text-muted-foreground">
                Add your USDA API key to <code>.env</code> to search foods. You
                can still enter foods manually below.
              </p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. chicken breast"
                    value={uq}
                    onChange={(e) => setUq(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runUsda()}
                  />
                  <Button onClick={runUsda} disabled={uLoading} size="icon">
                    {uLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {uErr && <p className="text-sm text-destructive">{uErr}</p>}
                {uResults.length > 0 && (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {uResults.map((r) => (
                      <button
                        key={r.fdcId}
                        type="button"
                        onClick={() => pickUsda(r)}
                        className="block w-full p-2 text-left text-sm active:bg-accent"
                      >
                        <span className="font-medium">{r.description}</span>
                        {r.brand && (
                          <span className="text-muted-foreground"> · {r.brand}</span>
                        )}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({r.dataType})
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Picking a result fills the form below (per 100 g). Adjust the
                  serving and values, then save your copy.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Basic info */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fname">Name</Label>
              <Input
                id="fname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Food name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fbrand">Brand (optional)</Label>
              <Input
                id="fbrand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sqty">Serving size</Label>
                <Input
                  id="sqty"
                  type="number"
                  inputMode="decimal"
                  value={servingQty}
                  onChange={(e) => setServingQty(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sunit">Unit</Label>
                <Input
                  id="sunit"
                  value={servingUnit}
                  onChange={(e) => setServingUnit(e.target.value)}
                  placeholder="g, cup, piece…"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Nutrients */}
        <Card>
          <CardHeader>
            <CardTitle>Nutrition (per serving)</CardTitle>
          </CardHeader>
          <CardContent>
            <NutrientFields values={nutrients} onChange={setNutrient} />
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          onClick={onSave}
          disabled={saveFood.isPending || !name.trim()}
        >
          {saveFood.isPending ? 'Saving…' : 'Save to my foods'}
        </Button>
      </div>
    </div>
  )
}
