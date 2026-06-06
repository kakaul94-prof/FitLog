import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useRecipes, useCreateRecipe } from '@/features/recipes/useRecipes'

export function RecipesPage() {
  const nav = useNavigate()
  const { data: recipes } = useRecipes()
  const create = useCreateRecipe()

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
            <Link
              key={r.id}
              to={`/recipes/${r.id}`}
              className="flex items-center gap-2 p-3 active:bg-accent"
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
