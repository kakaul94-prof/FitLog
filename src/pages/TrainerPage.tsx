import { useNavigate } from 'react-router-dom'
import { Brain, ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { TrainerChat } from '@/components/TrainerChat'
import { useTrainerMemory } from '@/features/trainer/useTrainerMemory'
import { cn } from '@/lib/utils'

// Ask a trainer: a chat about YOUR training, reached from the Exercise header.
// The conversation itself lives in TrainerChat, which is shared with the
// mid-workout overlay on WorkoutPage.
export function TrainerPage() {
  const nav = useNavigate()
  const memory = useTrainerMemory()

  return (
    <div className="mx-auto flex h-svh w-full max-w-md flex-col bg-background">
      <PageHeader
        title="Ask"
        subtitle="Training questions, answered from your log"
        left={
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Back">
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        action={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => nav('/lift/trainer/memory')}
            aria-label="What the trainer remembers"
          >
            <Brain className={cn('h-5 w-5', memory.length && 'text-primary')} />
          </Button>
        }
      />
      <TrainerChat />
    </div>
  )
}
