import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { dateLabel } from '@/lib/date'
import {
  MAX_FACTS,
  MAX_FACT_CHARS,
  useAddTrainerFact,
  useRemoveTrainerFact,
  useTrainerMemory,
} from '@/features/trainer/useTrainerMemory'

// What the trainer remembers. The chat proposes facts after a conversation, but
// this is the list of record — everything here is editable and deletable by
// hand, and everything here is sent up with every question.
export function TrainerMemoryPage() {
  const nav = useNavigate()
  const facts = useTrainerMemory()
  const { add } = useAddTrainerFact()
  const { remove } = useRemoveTrainerFact()
  const [draft, setDraft] = useState('')

  const onAdd = () => {
    if (!draft.trim()) return
    add(draft)
    setDraft('')
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-md bg-background pb-[env(safe-area-inset-bottom)]">
      <PageHeader
        title="Trainer memory"
        subtitle={`${facts.length} of ${MAX_FACTS} saved`}
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
      />

      <div className="space-y-4 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Lasting facts the trainer keeps in mind — a recurring niggle, kit you
          don't have, how you like to train. Your logged lifts are read fresh
          every time, so there's no need to record weights or PRs here.
        </p>

        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={MAX_FACT_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAdd()
              }
            }}
            placeholder="e.g. Left knee aches on deep squats"
          />
          <Button
            size="icon"
            onClick={onAdd}
            disabled={!draft.trim() || facts.length >= MAX_FACTS}
            aria-label="Add fact"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        {facts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing saved yet. Add something above, or let the trainer offer one
            after a conversation.
          </p>
        ) : (
          <div className="space-y-2">
            {[...facts].reverse().map((f) => (
              <Card key={f.id} className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{f.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Added {dateLabel(f.created_at.slice(0, 10))}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
                  onClick={() => remove(f.id)}
                  aria-label={`Forget: ${f.text}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
