import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Copy, Trash2, Link2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ImportRecipeSheet } from '@/components/ImportRecipeSheet'
import {
  useRecipes,
  useDeleteRecipe,
  useDuplicateRecipe,
} from '@/features/recipes/useRecipes'

// Body of the "Recipes" tab in LibraryPage. The new-recipe (+) action lives in
// the shared LibraryPage header; "Import from a link" lives here at the top.
export function RecipesList() {
  const nav = useNavigate()
  const { data: recipes } = useRecipes()
  const del = useDeleteRecipe()
  const duplicate = useDuplicateRecipe()
  const [importOpen, setImportOpen] = useState(false)

  const duplicateRecipe = async (id: string) => {
    const r = await duplicate.mutateAsync(id)
    nav(`/recipes/${r.id}`)
  }

  return (
    <div className="space-y-3 p-4">
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setImportOpen(true)}
      >
        <Link2 className="h-4 w-4" /> Import from a link
      </Button>

      <Card className="divide-y divide-border overflow-hidden">
        {(recipes ?? []).map((r) => (
          <div key={r.id} className="flex items-center">
            <Link
              to={`/recipes/${r.id}`}
              className="flex flex-1 items-center gap-2 p-3 active:bg-accent"
            >
              <div className="flex-1">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(r.nutrients.kcal ?? 0)} calories/serving · makes{' '}
                  {r.recipe_servings ?? 1}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
            <button
              type="button"
              className="p-3 text-muted-foreground active:text-primary disabled:opacity-50"
              onClick={() => duplicateRecipe(r.id)}
              disabled={duplicate.isPending}
              aria-label="Duplicate"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="p-3 text-muted-foreground active:text-destructive"
              onClick={() => {
                if (confirm(`Delete "${r.name}"?`)) del.mutate(r.id)
              }}
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {(recipes ?? []).length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No recipes yet. Import one from a link, or tap + to build one from
            your foods.
          </div>
        )}
      </Card>

      {importOpen && (
        <ImportRecipeSheet
          onClose={() => setImportOpen(false)}
          onImported={(id) => {
            setImportOpen(false)
            nav(`/recipes/${id}`)
          }}
        />
      )}
    </div>
  )
}
