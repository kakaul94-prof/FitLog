import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Camera, Loader2, X, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { scanPlate } from '@/lib/scanPlate'
import { scaleNutrients, roundNutrients } from '@/lib/nutrients'
import { canNativeCamera, captureLabelPhoto, isUserCancel } from '@/lib/capture'
import { useQuickAddFoods } from '@/features/diary/useDiary'
import { todayISO } from '@/lib/date'
import type { Meal, Nutrients } from '@/lib/database.types'

// Each detected item keeps its original grams + nutrients so editing the
// portion rescales from the model's estimate (never compounds).
type Item = {
  id: string
  name: string
  baseGrams: number
  baseNutrients: Nutrients
  grams: string
}

// Snap a plate -> Claude estimates foods + macros -> review/edit portions ->
// quick-add them all to the meal. A confirm-first draft: estimates are rough.
export function ScanMealPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') || todayISO()
  const meal = (params.get('meal') || 'breakfast') as Meal
  const back = params.get('returnTo') || `/?date=${date}`

  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'review'>('idle')
  const [items, setItems] = useState<Item[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const quickAdd = useQuickAddFoods()

  const runScan = async (file: File) => {
    setPhase('scanning')
    setErr('')
    try {
      const plate = await scanPlate(file)
      setItems(
        plate.items.map((it) => ({
          id: crypto.randomUUID(),
          name: it.name,
          baseGrams: it.grams,
          baseNutrients: it.nutrients,
          grams: String(Math.round(it.grams)),
        })),
      )
      setNote(plate.note)
      setPhase('review')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Scan failed.')
      setPhase('idle')
    }
  }

  // Native camera (live photo) when available; else the hidden file input.
  const takePhoto = async () => {
    if (!canNativeCamera()) {
      fileRef.current?.click()
      return
    }
    try {
      const file = await captureLabelPhoto()
      if (file) await runScan(file)
    } catch (e) {
      if (!isUserCancel(e))
        setErr(e instanceof Error ? e.message : 'Camera failed.')
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (file) runScan(file)
  }

  const scaledOf = (it: Item): Nutrients =>
    scaleNutrients(
      it.baseNutrients,
      it.baseGrams > 0 ? (parseFloat(it.grams) || 0) / it.baseGrams : 0,
    )

  const total = items.reduce(
    (acc, it) => {
      const n = scaledOf(it)
      acc.kcal += n.kcal ?? 0
      acc.protein += n.protein ?? 0
      acc.carb += n.carb ?? 0
      acc.fat += n.fat ?? 0
      return acc
    },
    { kcal: 0, protein: 0, carb: 0, fat: 0 },
  )

  const setGrams = (id: string, grams: string) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, grams } : it)))
  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((it) => it.id !== id))

  const logAll = () => {
    const payload = items
      .map((it) => ({ name: it.name, nutrients: roundNutrients(scaledOf(it)) }))
      .filter((it) => (it.nutrients.kcal ?? 0) > 0)
    if (payload.length === 0) return
    quickAdd.mutate({ entry_date: date, meal, items: payload })
    nav(`/?date=${date}`)
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Snap a meal"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(back)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />

      {phase !== 'review' ? (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-border text-muted-foreground">
            {phase === 'scanning' ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Camera className="h-8 w-8" />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {phase === 'scanning'
              ? 'Analyzing your meal…'
              : 'Photograph your plate for a rough calorie and macro estimate you can edit before logging.'}
          </p>
          {phase !== 'scanning' && (
            <Button onClick={takePhoto}>
              <Camera className="h-4 w-4" /> Take photo
            </Button>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      ) : (
        <div className="space-y-3 p-4 pb-40">
          <Card className="p-4">
            <div className="text-center">
              <span className="text-3xl font-bold">
                {Math.round(total.kcal)}
              </span>
              <span className="text-sm text-muted-foreground"> calories</span>
            </div>
            <div className="mt-2 flex justify-around text-center text-xs text-muted-foreground">
              <span>Protein {Math.round(total.protein)}g</span>
              <span>Carbs {Math.round(total.carb)}g</span>
              <span>Fat {Math.round(total.fat)}g</span>
            </div>
          </Card>

          <Card className="divide-y divide-border overflow-hidden">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(scaledOf(it).kcal ?? 0)} calories
                  </div>
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={it.grams}
                  onChange={(e) => setGrams(it.id, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  className="w-16 text-center"
                  aria-label={`${it.name} grams`}
                />
                <span className="text-xs text-muted-foreground">g</span>
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  aria-label={`Remove ${it.name}`}
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {items.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No items left — retake the photo or go back.
              </div>
            )}
          </Card>

          {note && (
            <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {note}
            </p>
          )}
          <p className="px-1 text-xs text-muted-foreground">
            Estimates are rough — adjust a portion and its calories update. Fix
            anything off before adding.
          </p>

          <Button variant="outline" className="w-full" onClick={takePhoto}>
            <Camera className="h-4 w-4" /> Retake photo
          </Button>
        </div>
      )}

      {phase === 'review' && items.length > 0 && (
        <div className="fixed bottom-0 left-1/2 w-full max-w-md -translate-x-1/2 border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button
            className="w-full"
            onClick={logAll}
            disabled={quickAdd.isPending}
          >
            {quickAdd.isPending ? 'Adding…' : 'Quick add all'}
          </Button>
        </div>
      )}
    </div>
  )
}
