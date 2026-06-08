import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  useMeals,
  useRenameMeal,
  useDeleteMeal,
  type MealWithItems,
} from '@/features/meals/useMeals'

export function MealsPage() {
  const nav = useNavigate()
  const { data: meals } = useMeals()
  const rename = useRenameMeal()
  const del = useDeleteMeal()

  const doRename = (m: MealWithItems) => {
    const name = window.prompt('Rename meal', m.name)?.trim()
    if (name && name !== m.name) rename.mutate({ id: m.id, name })
  }

  return (
    <div>
      <PageHeader
        title="Saved Meals"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/more')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          A saved meal logs all its foods as separate diary entries in one tap.
          Add meals to a day from the food picker’s “Meals” tab. Create one on
          the diary: long-press an entry → “Select multiple” → “Save as meal”.
        </p>

        {(meals ?? []).map((m) => {
          const kcal = Math.round(
            m.items.reduce(
              (s, it) => s + (it.nutrients.kcal ?? 0) * it.servings,
              0,
            ),
          )
          return (
            <Card key={m.id} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.items.length} {m.items.length === 1 ? 'item' : 'items'} ·{' '}
                    {kcal} kcal
                  </div>
                </div>
                <button
                  type="button"
                  className="p-1.5 text-muted-foreground active:text-primary"
                  onClick={() => doRename(m)}
                  aria-label={`Rename ${m.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="p-1.5 text-muted-foreground active:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete saved meal "${m.name}"?`))
                      del.mutate(m.id)
                  }}
                  aria-label={`Delete ${m.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {m.items.length > 0 && (
                <ul className="divide-y divide-border">
                  {m.items.map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between gap-2 p-3 text-sm"
                    >
                      <span className="min-w-0 truncate">{it.food_name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {it.servings} × {it.serving_qty} {it.serving_unit} ·{' '}
                        {Math.round((it.nutrients.kcal ?? 0) * it.servings)} kcal
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}

        {(meals ?? []).length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No saved meals yet.
          </Card>
        )}
      </div>
    </div>
  )
}
