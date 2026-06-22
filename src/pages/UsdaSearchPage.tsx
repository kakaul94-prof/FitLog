import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Search, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  searchUsdaFoods,
  USDA_MAX_RESULTS,
  type UsdaSearchItem,
} from '@/lib/usda'
import { buildUsdaDraft } from '@/lib/foodDraft'

// Full results for a USDA query (up to USDA_MAX_RESULTS), reached from the
// "See all results" link in the source sheet. `next` is the /foods/new URL a
// pick should open pre-filled — kept in the query string so it survives a
// reload and rides through to the food form via router state.
export function UsdaSearchPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const next = params.get('next') || '/foods/new'

  const [query, setQuery] = useState(q)
  const [results, setResults] = useState<UsdaSearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [importing, setImporting] = useState<number | null>(null)

  useEffect(() => {
    setQuery(q)
    if (!q.trim()) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setErr('')
    searchUsdaFoods(q.trim(), { limit: USDA_MAX_RESULTS, signal: ctrl.signal })
      .then(setResults)
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setResults([])
        setErr(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [q])

  const runSearch = () => {
    const t = query.trim()
    if (t) setParams({ q: t, next }, { replace: true })
  }

  // Import the chosen food, then open the pre-filled form at `next`.
  const pick = async (item: UsdaSearchItem) => {
    setImporting(item.fdcId)
    setErr('')
    try {
      const draft = await buildUsdaDraft(item.fdcId)
      nav(next, { state: { draft } })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed')
      setImporting(null)
    }
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background">
      <PageHeader
        title="USDA database"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search foods"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <Button onClick={runSearch} disabled={loading} size="icon">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}

        {results.length > 0 && (
          <Card className="divide-y divide-border overflow-hidden">
            {results.map((r) => (
              <button
                key={r.fdcId}
                onClick={() => pick(r)}
                disabled={importing != null}
                className="flex w-full items-center gap-3 p-3 text-left active:bg-accent disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{r.description}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.brand ? `${r.brand} · ` : ''}
                    {r.dataType}
                  </div>
                </div>
                {importing === r.fdcId && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </button>
            ))}
          </Card>
        )}

        {!loading && !err && q.trim() && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No USDA matches for "{q.trim()}".
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Pick a result to open the food form, pre-filled (per 100 g). Set your
          serving size — the nutrition rescales to match.
        </p>
      </div>
    </div>
  )
}
