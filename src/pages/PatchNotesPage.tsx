import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { dateLabel } from '@/lib/date'
import { patchNotes } from '@/data/patchNotes.generated'

export function PatchNotesPage() {
  const nav = useNavigate()
  const notes = patchNotes.slice(0, 5)

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
        {notes.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No patch notes yet.
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {notes.map((n) => (
              <div key={n.hash} className="flex items-start gap-3 p-4">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dateLabel(n.date)}
                  </p>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
