import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ChevronLeft,
  Search,
  Loader2,
  Plus,
  Trash2,
  RotateCcw,
  Pencil,
  Camera,
  ScanBarcode,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NutrientFields } from '@/components/NutrientFields'
import { useFood, useSaveFood } from '@/features/foods/useFoods'
import { useAddIngredient } from '@/features/recipes/useRecipes'
import { useLogFood } from '@/features/diary/useDiary'
import { scanLabel, type ScannedFood } from '@/lib/scanLabel'
import { detectBarcodeFromImage, lookupBarcode } from '@/lib/barcode'
import {
  searchUsdaFoods,
  getUsdaFood,
  isUsdaConfigured,
  type UsdaSearchItem,
} from '@/lib/usda'
import {
  scaleNutrients,
  roundNutrients,
  massUnitToGrams,
  computePortionNutrients,
} from '@/lib/nutrients'
import type { Food, Meal, NutrientKey, Nutrients, Portion } from '@/lib/database.types'

export function FoodFormPage() {
  const nav = useNavigate()
  const { id } = useParams()
  const [params] = useSearchParams()
  const addToRecipe = params.get('addToRecipe')
  const returnTo = params.get('returnTo')
  const backTo = returnTo || (addToRecipe ? `/recipes/${addToRecipe}` : '/foods')
  // When opened from "Add to {meal}", we can log this food straight to the diary.
  const mealParam = params.get('meal')
  const dateParam = params.get('date')
  const logTo =
    mealParam && dateParam ? { meal: mealParam as Meal, date: dateParam } : null
  const { data: existing } = useFood(id)
  const saveFood = useSaveFood()
  const addIng = useAddIngredient()
  const log = useLogFood()

  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [servingQty, setServingQty] = useState('1')
  const [servingUnit, setServingUnit] = useState('serving')
  const [servingGrams, setServingGrams] = useState('')
  const [source, setSource] = useState<Food['source']>('manual')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [nutrients, setNutrients] = useState<Nutrients>({})
  const [portions, setPortions] = useState<Portion[]>([])

  const [uq, setUq] = useState('')
  const [uResults, setUResults] = useState<UsdaSearchItem[]>([])
  const [uLoading, setULoading] = useState(false)
  const [uErr, setUErr] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [bcLoading, setBcLoading] = useState(false)
  const [manualBarcode, setManualBarcode] = useState('')
  const [scanErr, setScanErr] = useState('')
  const [scanWarnings, setScanWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setBrand(existing.brand ?? '')
    setServingQty(String(existing.serving_qty))
    setServingUnit(existing.serving_unit)
    setServingGrams(existing.serving_grams != null ? String(existing.serving_grams) : '')
    setSource(existing.source)
    setSourceId(existing.source_id)
    setNutrients(roundNutrients(existing.nutrients ?? {}))
    setPortions(existing.portions ?? [])
    servingBaseRef.current = existing.serving_qty
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

  // serving qty that the current `nutrients` correspond to; used to rescale by new/old
  const servingBaseRef = useRef(1)
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6

  const scaleToServing = () => {
    const base = servingBaseRef.current
    const next = parseFloat(servingQty)
    if (!Number.isFinite(next) || next <= 0 || base <= 0 || next === base) {
      if (Number.isFinite(next) && next > 0) servingBaseRef.current = next
      return { nutrients, servingGrams }
    }
    const factor = next / base
    servingBaseRef.current = next
    const scaled = roundNutrients(scaleNutrients(nutrients, factor))
    const g = parseFloat(servingGrams)
    const grams =
      Number.isFinite(g) && g > 0 ? String(round6(g * factor)) : servingGrams
    return { nutrients: scaled, servingGrams: grams }
  }

  const onServingBlur = () => {
    const r = scaleToServing()
    setNutrients(r.nutrients)
    setServingGrams(r.servingGrams)
  }

  // Base gram weight drives auto-scaling of the alternate units below.
  const baseGramsNum = parseFloat(servingGrams)
  const baseGramsValid = Number.isFinite(baseGramsNum) && baseGramsNum > 0

  const addPortion = () =>
    setPortions((p) => [...p, { id: crypto.randomUUID(), label: '', grams: null }])

  const patchPortion = (pid: string, patch: Partial<Portion>) =>
    setPortions((p) => p.map((x) => (x.id === pid ? { ...x, ...patch } : x)))

  const removePortion = (pid: string) =>
    setPortions((p) => p.filter((x) => x.id !== pid))

  // When a unit is named (cup, oz…), prefill grams if it's a known mass unit.
  const onPortionLabelBlur = (pid: string) => {
    const p = portions.find((x) => x.id === pid)
    if (!p || p.grams != null) return
    const g = massUnitToGrams(p.label)
    if (g != null) patchPortion(pid, { grams: g })
  }

  const setPortionGrams = (pid: string, v: string) => {
    const n = parseFloat(v)
    patchPortion(pid, { grams: v === '' || Number.isNaN(n) ? null : n })
  }

  // Seed the override with the current auto-computed facts, then let it diverge.
  const customizePortion = (pid: string) => {
    const p = portions.find((x) => x.id === pid)
    if (!p) return
    const computed =
      computePortionNutrients(nutrients, baseGramsValid ? baseGramsNum : null, p) ??
      {}
    patchPortion(pid, { nutrients: { ...computed } })
  }

  const resetPortion = (pid: string) => patchPortion(pid, { nutrients: undefined })

  const setPortionNutrient = (pid: string, k: NutrientKey, v: string) =>
    setPortions((prev) =>
      prev.map((x) => {
        if (x.id !== pid) return x
        const next = { ...(x.nutrients ?? {}) }
        const num = parseFloat(v)
        if (v === '' || Number.isNaN(num)) delete next[k]
        else next[k] = num
        return { ...x, nutrients: next }
      }),
    )

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
      setNutrients(roundNutrients(d.nutrients))
      setPortions([])
      servingBaseRef.current = d.serving_qty
      setUResults([])
      setUq('')
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setULoading(false)
    }
  }

  // Fill the form from a scanned label or barcode lookup, for the user to review.
  const applyScanned = (d: ScannedFood, sourceId: string | null) => {
    setName(d.name)
    setBrand(d.brand ?? '')
    setServingQty(String(d.serving_qty))
    setServingUnit(d.serving_unit)
    setServingGrams(d.serving_grams != null ? String(d.serving_grams) : '')
    setSource('manual')
    setSourceId(sourceId)
    setNutrients(roundNutrients(d.nutrients))
    setPortions([])
    servingBaseRef.current = d.serving_qty
    setScanWarnings(d.warnings)
  }

  const onScanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setScanLoading(true)
    setScanErr('')
    setScanWarnings([])
    try {
      applyScanned(await scanLabel(file), null)
    } catch (err) {
      setScanErr(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setScanLoading(false)
    }
  }

  const onBarcodeFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setBcLoading(true)
    setScanErr('')
    setScanWarnings([])
    try {
      const code = await detectBarcodeFromImage(file)
      if (!code) {
        setScanErr(
          'No barcode detected. Get it straight-on and in focus, or type the digits below.',
        )
        return
      }
      applyScanned(await lookupBarcode(code), code.replace(/\D/g, ''))
    } catch (err) {
      setScanErr(err instanceof Error ? err.message : 'Barcode scan failed')
    } finally {
      setBcLoading(false)
    }
  }

  const onManualBarcode = async () => {
    const code = manualBarcode.trim()
    if (!code) return
    setBcLoading(true)
    setScanErr('')
    setScanWarnings([])
    try {
      applyScanned(await lookupBarcode(code), code.replace(/\D/g, ''))
      setManualBarcode('')
    } catch (err) {
      setScanErr(err instanceof Error ? err.message : 'Barcode lookup failed')
    } finally {
      setBcLoading(false)
    }
  }

  // Persist the current form to the food library, returning the saved food.
  const persist = async (): Promise<Food> => {
    const r = scaleToServing()
    setNutrients(r.nutrients)
    setServingGrams(r.servingGrams)
    const cleanPortions: Portion[] = portions
      .filter((p) => p.label.trim())
      .map((p) => ({
        id: p.id,
        label: p.label.trim(),
        grams:
          p.grams != null && Number.isFinite(p.grams) && p.grams > 0
            ? p.grams
            : null,
        ...(p.nutrients && Object.keys(p.nutrients).length > 0
          ? { nutrients: p.nutrients }
          : {}),
      }))
    return saveFood.mutateAsync({
      id,
      name: name.trim(),
      brand: brand.trim() || null,
      source,
      source_id: sourceId,
      serving_qty: parseFloat(servingQty) || 1,
      serving_unit: servingUnit.trim() || 'serving',
      serving_grams: r.servingGrams ? parseFloat(r.servingGrams) : null,
      recipe_servings: null,
      nutrients: r.nutrients,
      portions: cleanPortions,
    })
  }

  const onSave = async () => {
    if (!name.trim()) return
    const saved = await persist()
    if (addToRecipe && !id) {
      await addIng.mutateAsync({
        recipeFoodId: addToRecipe,
        ingredientFoodId: saved.id,
        servings: 1,
      })
    }
    nav(backTo)
  }

  // Save any edits, then log one serving of this food to the meal we came from.
  const addToMeal = async () => {
    if (!name.trim() || !logTo) return
    const saved = await persist()
    await log.mutateAsync({
      entry_date: logTo.date,
      meal: logTo.meal,
      food: saved,
      servings: 1,
    })
    nav('/')
  }

  return (
    <div>
      <PageHeader
        title={id ? 'Edit food' : 'Add food'}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(backTo)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        {/* Scan a label or barcode */}
        <Card>
          <CardHeader>
            <CardTitle>Scan a label or barcode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onScanFile}
            />
            <input
              ref={barcodeRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onBarcodeFile}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={scanLoading || bcLoading}
            >
              {scanLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading label…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" /> Scan nutrition label
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => barcodeRef.current?.click()}
              disabled={scanLoading || bcLoading}
            >
              {bcLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking up…
                </>
              ) : (
                <>
                  <ScanBarcode className="h-4 w-4" /> Scan barcode
                </>
              )}
            </Button>
            <div className="flex gap-2">
              <Input
                placeholder="Or enter barcode digits"
                inputMode="numeric"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onManualBarcode()}
              />
              <Button
                onClick={onManualBarcode}
                disabled={scanLoading || bcLoading || !manualBarcode.trim()}
                size="icon"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            {scanErr && <p className="text-sm text-destructive">{scanErr}</p>}
            {scanWarnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                {scanWarnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Photograph the Nutrition Facts panel, or scan/enter a product
              barcode (via Open Food Facts). The values fill the form below —
              review them, then save.
            </p>
          </CardContent>
        </Card>

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
                  Picking a result fills the form below (per 100 g). Set your
                  serving size — the nutrition rescales to match. Tweak anything,
                  then save your copy.
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
                  onBlur={onServingBlur}
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
            <div className="space-y-1.5">
              <Label htmlFor="sgrams">Weight per serving (g)</Label>
              <Input
                id="sgrams"
                type="number"
                inputMode="decimal"
                value={servingGrams}
                onChange={(e) => setServingGrams(e.target.value)}
                placeholder="optional"
              />
              <p className="text-xs text-muted-foreground">
                The mass of one serving. Set this to auto-scale the units below.
              </p>
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

        {/* Other serving units */}
        <Card>
          <CardHeader>
            <CardTitle>Other serving units</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!baseGramsValid && portions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Set “Weight per serving (g)” above, then add units like cup, oz,
                or slice — their nutrition scales automatically, and you can edit
                it.
              </p>
            )}
            {portions.map((p) => {
              const computed = computePortionNutrients(
                nutrients,
                baseGramsValid ? baseGramsNum : null,
                p,
              )
              const overridden = p.nutrients != null
              return (
                <div
                  key={p.id}
                  className="space-y-2 rounded-md border border-border p-3"
                >
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label>Unit</Label>
                      <Input
                        value={p.label}
                        onChange={(e) =>
                          patchPortion(p.id, { label: e.target.value })
                        }
                        onBlur={() => onPortionLabelBlur(p.id)}
                        placeholder="cup, oz, slice…"
                      />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <Label>Weight (g)</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={p.grams ?? ''}
                        onChange={(e) => setPortionGrams(p.id, e.target.value)}
                        placeholder="grams"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePortion(p.id)}
                      className="mt-6 shrink-0 p-2 text-muted-foreground active:text-destructive"
                      aria-label="Remove unit"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {overridden
                        ? 'Custom facts'
                        : computed
                          ? `${Math.round(computed.kcal ?? 0)} kcal · auto`
                          : 'Set a weight, or customize facts'}
                    </span>
                    {overridden ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetPortion(p.id)}
                      >
                        <RotateCcw className="h-4 w-4" /> Reset to auto
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => customizePortion(p.id)}
                      >
                        <Pencil className="h-4 w-4" /> Edit facts
                      </Button>
                    )}
                  </div>

                  {overridden && (
                    <NutrientFields
                      values={p.nutrients ?? {}}
                      onChange={(k, v) => setPortionNutrient(p.id, k, v)}
                    />
                  )}
                </div>
              )
            })}
            <Button variant="outline" className="w-full" onClick={addPortion}>
              <Plus className="h-4 w-4" /> Add a unit
            </Button>
          </CardContent>
        </Card>

        {logTo && (
          <Button
            className="w-full"
            size="lg"
            onClick={addToMeal}
            disabled={saveFood.isPending || log.isPending || !name.trim()}
          >
            {saveFood.isPending || log.isPending
              ? 'Adding…'
              : `Add to ${logTo.meal}`}
          </Button>
        )}
        <Button
          className="w-full"
          size="lg"
          variant={logTo ? 'outline' : 'default'}
          onClick={onSave}
          disabled={saveFood.isPending || addIng.isPending || !name.trim()}
        >
          {saveFood.isPending || addIng.isPending
            ? 'Saving…'
            : addToRecipe
              ? 'Save & add to recipe'
              : 'Save to my foods'}
        </Button>
      </div>
    </div>
  )
}
