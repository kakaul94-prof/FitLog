import { useMemo, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  REHAB_EXERCISES,
  protocolsForSite,
  rehabForSite,
  type RehabExercise,
} from '@/data/rehabExercises'
import { painLabel } from '@/lib/rehab'
import type { RehabPlanItem } from '@/lib/database.types'
import { cn } from '@/lib/utils'

type NewItem = Omit<RehabPlanItem, 'id'>

const toItem = (e: RehabExercise, targetPerWeek = 3): NewItem => ({
  key: e.key,
  name: e.name,
  targetPerWeek,
  holdSec: e.kind === 'hold' ? (e.holdSec ?? 30) : null,
})

/** Library + protocol picker for an injury's rehab plan. Protocols add several
 *  rows at once; everything is editable afterwards like a hand-typed row. */
export function RehabPicker({
  site,
  planKeys,
  busy,
  onAdd,
  onAddMany,
  onCancel,
}: {
  /** The injury's pain site — decides what's offered first. */
  site: string
  /** Library keys (or lowercased names) already in the plan. */
  planKeys: Set<string>
  busy: boolean
  onAdd: (item: NewItem) => void
  onAddMany: (items: NewItem[]) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [allSites, setAllSites] = useState(false)
  const [custom, setCustom] = useState('')

  const protocols = useMemo(() => protocolsForSite(site), [site])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const base = allSites || needle ? REHAB_EXERCISES : rehabForSite(site)
    return needle
      ? base.filter((e) => e.name.toLowerCase().includes(needle))
      : base
  }, [allSites, q, site])

  return (
    <Card className="space-y-4 p-3">
      {protocols.length > 0 && !q.trim() && (
        <section>
          <p className="mb-2 text-xs text-muted-foreground">
            Protocols for {painLabel(site).toLowerCase()}
          </p>
          <div className="space-y-2">
            {protocols.map((p) => {
              const fresh = p.items.filter((i) => !planKeys.has(i.key))
              return (
                <button
                  key={p.id}
                  disabled={busy || fresh.length === 0}
                  onClick={() =>
                    onAddMany(
                      fresh.map((i) => {
                        const ex = REHAB_EXERCISES.find((e) => e.key === i.key)!
                        return toItem(ex, i.targetPerWeek)
                      }),
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-border p-2.5 text-left disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.items.length} exercises · {p.blurb}
                    </p>
                  </div>
                  {fresh.length === 0 ? (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {q.trim() || allSites
              ? 'All exercises'
              : `${painLabel(site)} exercises`}
          </p>
          {!q.trim() && (
            <button
              onClick={() => setAllSites((a) => !a)}
              className="text-xs text-primary"
            >
              {allSites ? `Just ${painLabel(site).toLowerCase()}` : 'Show all'}
            </button>
          )}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search rehab exercises"
          aria-label="Search rehab exercises"
        />
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {list.map((e) => {
            const have = planKeys.has(e.key)
            return (
              <button
                key={e.key}
                disabled={busy || have}
                onClick={() => onAdd(toItem(e))}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg p-2 text-left',
                  have ? 'opacity-50' : 'active:bg-accent',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {e.name}
                    {e.kind === 'hold' && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {e.holdSec}s hold
                      </span>
                    )}
                  </p>
                  {e.cue && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {e.cue}
                    </p>
                  )}
                </div>
                {have ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Plus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })}
          {list.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">
              Nothing matches. Add it by name below.
            </p>
          )}
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs text-muted-foreground">
          Or add your own
        </p>
        <div className="flex gap-2">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Whatever your physio gave you"
            aria-label="Custom exercise name"
          />
          <Button
            disabled={busy || !custom.trim()}
            onClick={() => {
              onAdd({ name: custom.trim(), targetPerWeek: 3, holdSec: null })
              setCustom('')
            }}
          >
            Add
          </Button>
        </div>
      </section>

      <Button variant="outline" className="w-full" onClick={onCancel}>
        Done
      </Button>
    </Card>
  )
}
