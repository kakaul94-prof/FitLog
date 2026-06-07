import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, ChevronRight, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  useRecipes,
  useCreateRecipe,
  useDeleteRecipe,
} from '@/features/recipes/useRecipes'

export function RecipesPage() {
  const nav = useNavigate()
  const { data: recipes } = useRecipes()
  const create = useCreateRecipe()
  const del = useDeleteRecipe()

  const newRecipe = async () => {
    const r = await create.mutateAsync('New recipe')
    nav(`/recipes/${r.id}`)
  }

  return (
    <div>
      <PageHeader
        title="Recipes"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/more')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button size="icon" onClick={newRecipe} disabled={create.isPending}>
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
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
                    {Math.round(r.nutrients.kcal ?? 0)} kcal/serving · makes{' '}
                    {r.recipe_servings ?? 1}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
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
              No recipes yet. Tap + to build one from your foods.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
