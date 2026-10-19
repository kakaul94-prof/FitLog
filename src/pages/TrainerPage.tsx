import { useNavigate } from 'react-router-dom'
import { Brain, ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { NewChatButton, TrainerChat } from '@/components/TrainerChat'
import { GENERAL_THREAD } from '@/features/trainer/useTrainerChat'
import { useTrainerMemory } from '@/features/trainer/useTrainerMemory'
import { cn } from '@/lib/utils'

// Ask a trainer: a chat about YOUR training, reached from the Exercise header.
// The conversation itself lives in TrainerChat, which is shared with the
// mid-workout overlay on WorkoutPage. This page's thread is saved on the
// device, so leaving and coming back keeps it until New chat.
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
          <div className="flex items-center">
            <NewChatButton thread={GENERAL_THREAD} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => nav('/lift/trainer/memory')}
              aria-label="What the trainer remembers"
            >
              <Brain className={cn('h-5 w-5', memory.length && 'text-primary')} />
            </Button>
          </div>
        }
      />
      <TrainerChat thread={GENERAL_THREAD} />
    </div>
  )
}
