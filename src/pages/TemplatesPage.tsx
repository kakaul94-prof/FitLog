import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Play, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useRoutines, useStartFromRoutine } from '@/features/strength/useRoutines'
import { todayISO } from '@/lib/date'

export function TemplatesPage() {
  const nav = useNavigate()
  const { data: routines } = useRoutines()
  const startFrom = useStartFromRoutine()
  const [startingId, setStartingId] = useState<string | null>(null)

  const start = async (rid: string, name: string) => {
    setStartingId(rid)
    try {
      const id = await startFrom.mutateAsync({
        routineId: rid,
        name,
        date: todayISO(),
      })
      nav(`/workout/${id}`)
    } finally {
      setStartingId(null)
    }
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Templates"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            size="icon"
            aria-label="New template"
            onClick={() => nav('/routines/new')}
          >
            <Plus className="h-5 w-5" />
          </Button>
        }
      />
      <div className="space-y-2 p-4">
        <Card className="divide-y divide-border overflow-hidden">
          {(routines ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 p-3">
              <Link to={`/routines/${r.id}`} className="min-w-0 flex-1">
                <span className="text-sm font-medium">{r.name}</span>
              </Link>
              <Button
                size="sm"
                onClick={() => start(r.id, r.name)}
                disabled={startFrom.isPending}
              >
                <Play className="h-3.5 w-3.5" />
                {startingId === r.id ? 'Starting…' : 'Start'}
              </Button>
            </div>
          ))}
          {routines && routines.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No templates yet. Tap + to create one.
            </div>
          )}
        </Card>
        <p className="px-1 text-xs text-muted-foreground">
          Tap a template to edit it.
        </p>
      </div>
    </div>
  )
}
