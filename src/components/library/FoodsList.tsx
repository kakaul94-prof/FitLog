import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useFoods, useDeleteFood } from '@/features/foods/useFoods'

// Body of the "Foods" tab in LibraryPage. The add (+) action lives in the
// shared LibraryPage header.
export function FoodsList() {
  const [search, setSearch] = useState('')
  const { data: foods, isLoading } = useFoods(search)
  const del = useDeleteFood()

  return (
    <div className="space-y-3 p-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search your foods"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !foods || foods.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No foods yet. Tap{' '}
          <Plus className="inline h-4 w-4 align-text-bottom" /> to add one from
          USDA or by hand.
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {foods.map((f) => (
            <div key={f.id} className="flex items-center">
              <Link
                to={`/foods/${f.id}`}
                className="flex-1 p-3 active:bg-accent"
              >
                <div className="text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(f.nutrients.kcal ?? 0)} calories · {f.serving_qty}{' '}
                  {f.serving_unit}
                  {f.brand ? ` · ${f.brand}` : ''}
                </div>
              </Link>
              <button
                type="button"
                className="p-3 text-muted-foreground active:text-destructive"
                onClick={() => {
                  if (confirm(`Delete "${f.name}"?`)) del.mutate(f.id)
                }}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
