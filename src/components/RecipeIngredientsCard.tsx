import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRecipe } from '@/features/recipes/useRecipes'
import { ingredientNutrients, resolveIngredientUnit } from '@/lib/nutrients'
import { cn } from '@/lib/utils'

/**
 * Collapsible, read-only list of a recipe's ingredients (whole-recipe amounts)
 * with a jump into the recipe editor. Renders nothing unless `foodId` is a
 * recipe. It shows the recipe as it is now — a logged entry's numbers are a
 * snapshot and don't follow later recipe edits.
 */
export function RecipeIngredientsCard({
  foodId,
  defaultOpen = false,
  className,
}: {
  foodId: string | null | undefined
  defaultOpen?: boolean
  className?: string
}) {
  const nav = useNavigate()
  const { data } = useRecipe(foodId ?? undefined)
  const [open, setOpen] = useState(defaultOpen)
  const recipe = data?.recipe
  if (!recipe || recipe.source !== 'recipe') return null
  const rows = data.ingredients
  const makes = recipe.recipe_servings ?? 1

  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left active:bg-accent"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 text-sm font-medium">
          Ingredients ({rows.length})
        </span>
        <span className="text-xs text-muted-foreground">
          makes {makes} {makes === 1 ? 'serving' : 'servings'}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-3">
          <p className="pt-2 text-xs text-muted-foreground">
            Amounts for the whole recipe
          </p>
          {rows.length ? (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto">
              {rows.map(({ ri, food }) => {
                const amt = ri.amount ?? ri.servings
                const unit = ri.unit ?? 'base'
                const label = food ? resolveIngredientUnit(food, unit).label : ''
                const kcal = food ? ingredientNutrients(food, amt, unit).kcal ?? 0 : 0
                return (
                  <li key={ri.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {food?.name ?? 'Unknown'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatAmount(amt, label)} · {Math.round(kcal)} cal
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">No ingredients yet.</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => nav(`/recipes/${recipe.id}`, { state: { fromEntry: true } })}
          >
            <Pencil className="h-4 w-4" /> Edit recipe
          </Button>
        </div>
      )}
    </div>
  )
}

// "454 g", "2 cup" — or "2 × 100 g" when the unit label carries its own count.
function formatAmount(amount: number, label: string): string {
  const n = String(+amount.toFixed(2))
  if (!label) return n
  return /^\d/.test(label) ? `${n} × ${label}` : `${n} ${label}`
}
