import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Plus, X, Search, Copy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { NutrientBreakdown } from '@/components/NutrientBreakdown'
import { StartFromSourceSheet } from '@/components/StartFromSourceSheet'
import { useFoods } from '@/features/foods/useFoods'
import { ingredientUnits, ingredientNutrients } from '@/lib/nutrients'
import type { Food } from '@/lib/database.types'
import type { RecipeIngredientRow } from '@/features/recipes/useRecipes'
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
  const [sourceOpen, setSourceOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: foods } = useFoods(search)

  useEffect(() => {
    if (recipe) {
      setName(recipe.name)
      setYieldServings(String(recipe.recipe_servings ?? 1))
    }
  }, [recipe])

  const pick = async (food: Food) => {
    await addIng.mutateAsync({
      recipeFoodId: id!,
      food,
      amount: 1,
      unit: 'base',
    })
    setAdding(false)
    setSearch('')
  }

  const options = (foods ?? []).filter((f) => f.id !== id)

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
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
            {ingredients.map((row) => (
              <IngredientRow
                key={row.ri.id}
                row={row}
                onChange={(amount, unit) =>
                  row.food &&
                  updateIng.mutate({
                    id: row.ri.id,
                    recipeFoodId: id!,
                    food: row.food,
                    amount,
                    unit,
                  })
                }
                onRemove={() =>
                  removeIng.mutate({ id: row.ri.id, recipeFoodId: id! })
                }
              />
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
                  onClick={() => pick(f)}
                  className="block w-full p-2 text-left text-sm active:bg-accent"
                >
                  {f.name}{' '}
                  <span className="text-xs text-muted-foreground">
                    · {Math.round(f.nutrients.kcal ?? 0)} calories
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
              onClick={() => setSourceOpen(true)}
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

      {sourceOpen && (
        <StartFromSourceSheet
          onClose={() => setSourceOpen(false)}
          newFoodPath={`/foods/new?addToRecipe=${id}`}
        />
      )}
    </div>
  )
}

function IngredientRow({
  row,
  onChange,
  onRemove,
}: {
  row: RecipeIngredientRow
  onChange: (amount: number, unit: string) => void
  onRemove: () => void
}) {
  const { ri, food } = row
  const units = food ? ingredientUnits(food) : []
  const [amount, setAmount] = useState(String(ri.amount ?? ri.servings))
  const [unit, setUnit] = useState(ri.unit ?? 'base')

  // Resync when the row reloads (e.g. after a save invalidates the query).
  useEffect(() => {
    setAmount(String(ri.amount ?? ri.servings))
    setUnit(ri.unit ?? 'base')
  }, [ri.amount, ri.servings, ri.unit])

  const amt = parseFloat(amount) || 0
  const kcal = food ? ingredientNutrients(food, amt, unit).kcal ?? 0 : 0

  const commitAmount = () => {
    if (amt > 0 && (amt !== (ri.amount ?? ri.servings) || unit !== (ri.unit ?? 'base')))
      onChange(amt, unit)
  }
  const commitUnit = (nextUnit: string) => {
    setUnit(nextUnit)
    if (amt > 0) onChange(amt, nextUnit)
  }

  return (
    <div className="flex items-center gap-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {food?.name ?? 'Unknown'}
        </div>
        <div className="text-xs text-muted-foreground">
          {Math.round(kcal)} calories
        </div>
      </div>
      <Input
        className="h-9 w-14"
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={commitAmount}
        aria-label="Amount"
      />
      <Select
        className="h-9 w-24"
        value={unit}
        onChange={(e) => commitUnit(e.target.value)}
        disabled={!food}
        aria-label="Unit"
      >
        {units.map((u) => (
          <option key={u.unit} value={u.unit}>
            {u.label}
          </option>
        ))}
      </Select>
      <button
        onClick={onRemove}
        className="text-muted-foreground active:text-destructive"
        aria-label="Remove"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
