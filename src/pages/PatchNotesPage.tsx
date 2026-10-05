import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { dateLabel } from '@/lib/date'
import { patchNotes } from '@/data/patchNotes.generated'

export function PatchNotesPage() {
  const nav = useNavigate()
  const pushes = patchNotes.slice(0, 5)

  return (
    <div>
      <PageHeader
        title="Patch Notes"
        left={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/more')}
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          The latest updates to FitLog.
        </p>
        {pushes.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No patch notes yet.
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {pushes.map((push) => (
              <div key={push.notes[0].hash} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {dateLabel(push.date)}
                  </p>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {push.notes.length}{' '}
                    {push.notes.length === 1 ? 'update' : 'updates'}
                  </span>
                </div>
                <ul className="space-y-2">
                  {push.notes.map((n) => (
                    <li key={n.hash} className="flex items-start gap-2.5">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-sm font-medium">{n.title}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
