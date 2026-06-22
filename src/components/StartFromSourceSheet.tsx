import { useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { Search, Camera, ScanBarcode, Loader2, Pencil, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { scanLabel, type ScannedFood } from '@/lib/scanLabel'
import { detectBarcodeFromImage, lookupBarcode } from '@/lib/barcode'
import {
  searchUsdaFoods,
  getUsdaFood,
  isUsdaConfigured,
  type UsdaSearchItem,
} from '@/lib/usda'
import { roundNutrients } from '@/lib/nutrients'
import type { Food, Nutrients, Portion } from '@/lib/database.types'
import { cn } from '@/lib/utils'

// A food pre-filled from a source, handed to the food form via router state.
export type FoodDraft = {
  name: string
  brand: string
  serving_qty: number
  serving_unit: string
  serving_grams: number | null
  source: Food['source']
  source_id: string | null
  nutrients: Nutrients
  portions: Portion[]
  warnings?: string[]
}

// Bottom-sheet that starts a new food from a source (USDA search, a scanned
// label, or a barcode), or lets you skip straight to manual entry. Picking a
// source emits a draft via onPick; the caller opens the food form pre-filled.
export function StartFromSourceSheet({
  onClose,
  onPick,
  onManual,
}: {
  onClose: () => void
  onPick: (draft: FoodDraft) => void
  onManual: () => void
}) {
  const [tab, setTab] = useState<'search' | 'label' | 'barcode'>(
    isUsdaConfigured ? 'search' : 'label',
  )

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
      onPick({
        name: d.name,
        brand: d.brand ?? '',
        serving_qty: d.serving_qty,
        serving_unit: d.serving_unit,
        serving_grams: d.serving_grams ?? null,
        source: 'usda',
        source_id: d.source_id,
        nutrients: roundNutrients(d.nutrients),
        portions: [],
      })
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setULoading(false)
    }
  }

  // Build a draft from a scanned label or barcode lookup, for the user to review.
  const emitScanned = (d: ScannedFood, sourceId: string | null) => {
    onPick({
      name: d.name,
      brand: d.brand ?? '',
      serving_qty: d.serving_qty,
      serving_unit: d.serving_unit,
      serving_grams: d.serving_grams ?? null,
      source: 'manual',
      source_id: sourceId,
      nutrients: roundNutrients(d.nutrients),
      portions: [],
      warnings: d.warnings,
    })
  }

  const onScanFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setScanLoading(true)
    setScanErr('')
    try {
      emitScanned(await scanLabel(file), null)
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
    try {
      const code = await detectBarcodeFromImage(file)
      if (!code) {
        setScanErr(
          'No barcode detected. Get it straight-on and in focus, or type the digits below.',
        )
        return
      }
      emitScanned(await lookupBarcode(code), code.replace(/\D/g, ''))
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
    try {
      emitScanned(await lookupBarcode(code), code.replace(/\D/g, ''))
    } catch (err) {
      setScanErr(err instanceof Error ? err.message : 'Barcode lookup failed')
    } finally {
      setBcLoading(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="flex items-center border-b border-border p-3">
            <span className="w-8" />
            <span className="flex-1 text-center text-sm font-medium">
              Start from a source
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3 p-4">
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

            <div className="flex rounded-lg bg-secondary p-0.5 text-sm">
              {(
                [
                  ['search', 'Search', Search],
                  ['label', 'Label', Camera],
                  ['barcode', 'Barcode', ScanBarcode],
                ] as const
              ).map(([key, lbl, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors',
                    tab === key
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground active:bg-accent',
                  )}
                >
                  <Icon className="h-4 w-4" /> {lbl}
                </button>
              ))}
            </div>

            {tab === 'search' &&
              (!isUsdaConfigured ? (
                <p className="text-sm text-muted-foreground">
                  Add your USDA API key to <code>.env</code> to search foods, or
                  enter a food manually.
                </p>
              ) : (
                <div className="space-y-2">
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
                    Pick a result to open the food form, pre-filled (per 100 g).
                    Set your serving size — the nutrition rescales to match.
                  </p>
                </div>
              ))}

            {tab === 'label' && (
              <div className="space-y-2">
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
                <p className="text-xs text-muted-foreground">
                  Photograph the Nutrition Facts panel — the values open the food
                  form pre-filled to review.
                </p>
              </div>
            )}

            {tab === 'barcode' && (
              <div className="space-y-2">
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
                <p className="text-xs text-muted-foreground">
                  Scan or type a product barcode (via Open Food Facts).
                </p>
              </div>
            )}

            {scanErr && <p className="text-sm text-destructive">{scanErr}</p>}

            <div className="border-t border-border pt-3">
              <Button variant="outline" className="w-full" onClick={onManual}>
                <Pencil className="h-4 w-4" /> Enter manually
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Skip the source and fill in the food yourself.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}
