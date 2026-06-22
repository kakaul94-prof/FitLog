import { useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, Camera, ScanBarcode, Loader2, Pencil, X, ArrowRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { scanLabel, type ScannedFood } from '@/lib/scanLabel'
import { detectBarcodeFromImage, lookupBarcode } from '@/lib/barcode'
import {
  searchUsdaFoods,
  isUsdaConfigured,
  USDA_PREVIEW_COUNT,
  USDA_MAX_RESULTS,
  type UsdaSearchItem,
} from '@/lib/usda'
import { roundNutrients } from '@/lib/nutrients'
import { buildUsdaDraft, type FoodDraft } from '@/lib/foodDraft'
import { cn } from '@/lib/utils'

// Top-anchored sheet that starts a new food from a source (USDA search, a
// scanned label, or a barcode), or skips straight to manual entry. Every path
// navigates to `newFoodPath` (the caller's /foods/new URL); USDA and scan
// results ride along pre-filled in router state as a draft.
export function StartFromSourceSheet({
  onClose,
  newFoodPath,
}: {
  onClose: () => void
  newFoodPath: string
}) {
  const nav = useNavigate()
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
      setUResults(await searchUsdaFoods(uq.trim(), { limit: USDA_MAX_RESULTS }))
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setULoading(false)
    }
  }

  // Open the full results page (top 50), carrying the destination so a pick
  // there lands on the same /foods/new the inline picks use.
  const seeAllUsda = () =>
    nav(
      `/foods/usda?q=${encodeURIComponent(uq.trim())}&next=${encodeURIComponent(
        newFoodPath,
      )}`,
    )

  const pickUsda = async (item: UsdaSearchItem) => {
    setULoading(true)
    setUErr('')
    try {
      const draft = await buildUsdaDraft(item.fdcId)
      nav(newFoodPath, { state: { draft } })
    } catch (e) {
      setUErr(e instanceof Error ? e.message : 'Import failed')
      setULoading(false)
    }
  }

  // Build a draft from a scanned label or barcode lookup, then open the form.
  const emitScanned = (d: ScannedFood, sourceId: string | null) => {
    const draft: FoodDraft = {
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
    }
    nav(newFoodPath, { state: { draft } })
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
      className="fixed inset-0 z-50 flex flex-col justify-start bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]"
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
                      {uResults.slice(0, USDA_PREVIEW_COUNT).map((r) => (
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
                  {uResults.length > USDA_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={seeAllUsda}
                      className="flex w-full items-center justify-center gap-1 py-1 text-sm font-medium text-primary active:opacity-70"
                    >
                      See all {uResults.length} results
                      <ArrowRight className="h-4 w-4" />
                    </button>
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
              <Button variant="outline" className="w-full" onClick={() => nav(newFoodPath)}>
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
