import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, X, Search, Copy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { useFoods } from '@/features/foods/useFoods'
import {
  useRecipe,
  useUpdateRecipe,
  useAddIngredient,
  useUpdateIngredient,
  useRemoveIngredient,
  useDuplicateRecipe,
} from '@/features/recipes/useRecipes'

export function RecipeEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data } = useRecipe(id)
  const recipe = data?.recipe
  const ingredients = data?.ingredients ?? []
  const updateRecipe = useUpdateRecipe()
  const addIng = useAddIngredient()
  const updateIng = useUpdateIngredient()
  const removeIng = useRemoveIngredient()
  const duplicate = useDuplicateRecipe()

  const [name, setName] = useState('')
  const [yieldServings, setYieldServings] = useState('1')
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const { data: foods } = useFoods(search)

  useEffect(() => {
    if (recipe) {
      setName(recipe.name)
      setYieldServings(String(recipe.recipe_servings ?? 1))
    }
  }, [recipe])

  const pick = async (foodId: string) => {
    await addIng.mutateAsync({
      recipeFoodId: id!,
      ingredientFoodId: foodId,
      servings: 1,
    })
    setAdding(false)
    setSearch('')
  }

  const options = (foods ?? []).filter((f) => f.id !== id)

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="Edit recipe"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/recipes')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Save as a copy"
            disabled={!recipe || duplicate.isPending}
            onClick={async () => {
              const r = await duplicate.mutateAsync(id!)
              nav(`/recipes/${r.id}`)
            }}
          >
            <Copy className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name !== recipe?.name)
                  updateRecipe.mutate({ id: id!, name: name.trim() })
              }}
              placeholder="e.g. Chicken stir-fry"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Yield (servings)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={yieldServings}
              onChange={(e) => setYieldServings(e.target.value)}
              onBlur={() => {
                const v = parseFloat(yieldServings) || 1
                if (v !== recipe?.recipe_servings)
                  updateRecipe.mutate({ id: id!, recipe_servings: v })
              }}
            />
          </div>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Ingredients
          </h2>
          <Card className="divide-y divide-border overflow-hidden">
            {ingredients.map(({ ri, food }) => (
              <div key={ri.id} className="flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {food?.name ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round((food?.nutrients.kcal ?? 0) * ri.servings)} kcal
                  </div>
                </div>
                <Input
                  className="h-9 w-16"
                  type="number"
                  inputMode="decimal"
                  defaultValue={String(ri.servings)}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value) || 0
                    if (v > 0 && v !== ri.servings)
                      updateIng.mutate({
                        id: ri.id,
                        recipeFoodId: id!,
                        servings: v,
                      })
                  }}
                />
                <button
                  onClick={() =>
                    removeIng.mutate({ id: ri.id, recipeFoodId: id! })
                  }
                  className="text-muted-foreground active:text-destructive"
                  aria-label="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {ingredients.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No ingredients yet.
              </div>
            )}
          </Card>
        </div>

        {adding ? (
          <Card className="p-2">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                autoFocus
                placeholder="Search your foods"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {options.map((f) => (
                <button
                  key={f.id}
                  onClick={() => pick(f.id)}
                  className="block w-full p-2 text-left text-sm active:bg-accent"
                >
                  {f.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    · {Math.round(f.nutrients.kcal ?? 0)} kcal
                  </span>
                </button>
              ))}
              {options.length === 0 && (
                <div className="p-2 text-center text-xs text-muted-foreground">
                  No matching foods. Tap “Create a new food” below.
                </div>
              )}
            </div>
            <Button
              variant="outline"
              className="mt-1 w-full"
              onClick={() => nav(`/foods/new?addToRecipe=${id}`)}
            >
              <Plus className="h-4 w-4" /> Create a new food
            </Button>
            <Button
              variant="ghost"
              className="mt-1 w-full"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </Card>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" /> Add ingredient
          </Button>
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            Per serving (makes {recipe?.recipe_servings ?? 1})
          </h2>
          {recipe && <NutrientBreakdown nutrients={recipe.nutrients} />}
        </div>
      </div>
    </div>
  )
}
