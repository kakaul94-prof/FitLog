import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FoodsList } from '@/components/library/FoodsList'
import { RecipesList } from '@/components/library/RecipesList'
import { MealsList } from '@/components/library/MealsList'
import { StartFromSourceSheet } from '@/components/StartFromSourceSheet'
import { useCreateRecipe } from '@/features/recipes/useRecipes'

type Tab = 'foods' | 'recipes' | 'meals'

// Each path maps to a tab (see the routes in App.tsx). Reusing the existing
// paths keeps deep links + the food-form / recipe-editor back buttons landing
// on the right tab for free.
const TABS: { value: Tab; label: string; path: string }[] = [
  { value: 'foods', label: 'Foods', path: '/foods' },
  { value: 'recipes', label: 'Recipes', path: '/recipes' },
  { value: 'meals', label: 'Saved Meals', path: '/meals' },
]

export function LibraryPage() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const create = useCreateRecipe()
  const [sourceOpen, setSourceOpen] = useState(false)

  const tab: Tab = pathname.startsWith('/recipes')
    ? 'recipes'
    : pathname.startsWith('/meals')
      ? 'meals'
      : 'foods'

  const newRecipe = async () => {
    const r = await create.mutateAsync('New recipe')
    nav(`/recipes/${r.id}`)
  }

  const action =
    tab === 'foods' ? (
      <Button size="icon" onClick={() => setSourceOpen(true)}>
        <Plus className="h-5 w-5" />
      </Button>
    ) : tab === 'recipes' ? (
      <Button size="icon" onClick={newRecipe} disabled={create.isPending}>
        <Plus className="h-5 w-5" />
      </Button>
    ) : undefined

  return (
    <div>
      <PageHeader
        title="Food Library"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav('/more')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={action}
      />

      <div className="px-4 pt-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-0.5">
          {TABS.map((t) => {
            const active = t.value === tab
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => nav(t.path, { replace: true })}
                aria-pressed={active}
                className={cn(
                  'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground active:bg-accent',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'foods' && <FoodsList />}
      {tab === 'recipes' && <RecipesList />}
      {tab === 'meals' && <MealsList />}

      {sourceOpen && (
        <StartFromSourceSheet
          onClose={() => setSourceOpen(false)}
          onManual={() => {
            setSourceOpen(false)
            nav('/foods/new')
          }}
          onPick={(draft) => nav('/foods/new', { state: { draft } })}
        />
      )}
    </div>
  )
}
