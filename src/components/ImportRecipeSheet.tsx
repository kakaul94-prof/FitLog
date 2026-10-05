import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link2, Loader2, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { importRecipe } from '@/lib/importRecipe'
import { useImportRecipe } from '@/features/recipes/useRecipes'

// Top-anchored sheet: paste a recipe URL, we read its ingredients + estimate
// nutrition, build the recipe (ingredient foods archived), then hand the new
// recipe id back so the caller can open the editor to review.
export function ImportRecipeSheet({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (recipeId: string) => void
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const importMut = useImportRecipe()

  const run = async () => {
    const link = url.trim()
    if (!link || loading) return
    setLoading(true)
    setErr('')
    try {
      const parsed = await importRecipe(link)
      const recipe = await importMut.mutateAsync(parsed)
      onImported(recipe.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed. Try again.')
      setLoading(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-start bg-black/40"
      onClick={loading ? undefined : onClose}
    >
      <div
        className="mx-auto w-full max-w-md p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]"
        onClick={(ev) => ev.stopPropagation()}
      >
        <Card className="overflow-hidden">
          <div className="flex items-center border-b border-border p-3">
            <span className="w-8" />
            <span className="flex-1 text-center text-sm font-medium">
              Import from a link
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-foreground disabled:opacity-40"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            {loading ? (
              <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                Reading the recipe…
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="recipe-url">
                    Paste a recipe URL
                  </label>
                  <Input
                    id="recipe-url"
                    autoFocus
                    inputMode="url"
                    placeholder="https://…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && run()}
                  />
                </div>
                <Button className="w-full" onClick={run} disabled={!url.trim()}>
                  <Link2 className="h-4 w-4" /> Import
                </Button>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <p className="text-xs text-muted-foreground">
                  We read the ingredients and estimate nutrition (macros only) —
                  you can edit everything after.
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  )
}
