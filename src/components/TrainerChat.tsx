import { useEffect, useId, useRef, useState } from 'react'
import { Brain, Plus, Send, Square, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildTrainerContext } from '@/lib/trainerContext'
import { useAddTrainerFact, useTrainerMemory } from '@/features/trainer/useTrainerMemory'
import {
  askInThread,
  clearRememberChip,
  clearThread,
  discardThread,
  scratchThread,
  stopThread,
  useTrainerThread,
} from '@/features/trainer/useTrainerChat'
import { cn } from '@/lib/utils'

// The Ask-a-trainer conversation: message list + composer, no header. Lives in
// several places — TrainerPage (/lift/trainer), a full-screen overlay on
// WorkoutPage (which must NOT unmount the workout underneath it mid-session)
// and the pre-workout check-in.
//
// The conversation itself lives in a store (useTrainerChat), keyed by `thread`,
// so closing and reopening the chat keeps it — and a reply still streaming
// keeps going. No `thread` = a one-off chat, dropped when it closes.
//
// Expects a flex-column parent with a bounded height; it fills what it's given.

const STARTERS = [
  'My left knee aches when I squat — what should I do?',
  "What's the best way to add weight to my squat?",
  'Am I eating enough to keep progressing?',
  'Why has my bench stalled?',
]

/** Shorter prompts: mid-workout you're standing between sets, not reading. */
const WORKOUT_STARTERS = [
  'How is this session going so far?',
  'Should I add another set?',
  'This felt heavy — drop the weight?',
  'My shoulder is niggling on this one.',
]

export function TrainerChat({
  workoutId,
  thread,
  initialDraft,
}: {
  workoutId?: string
  /** Saved conversation to show and add to (see useTrainerChat for keys). */
  thread?: string
  /** Pre-filled question (the pre-workout check-in's "Ask trainer"). */
  initialDraft?: string
}) {
  const memory = useTrainerMemory()
  const { add: addFact } = useAddTrainerFact()

  const scratchId = useId()
  const key = thread ?? scratchThread(scratchId)
  const { bubbles, busy } = useTrainerThread(key)
  const [draft, setDraft] = useState(initialDraft ?? '')
  const [saved, setSaved] = useState<string | null>(null)

  // The training snapshot is a handful of queries, built on the first question
  // after each open — so a reopened workout chat sees the sets logged since.
  const contextRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stick to the bottom as the reply streams in (and on reopening).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [bubbles])

  // A one-off chat goes when it closes, in-flight answer and all.
  useEffect(() => {
    if (thread) return
    return () => discardThread(key)
  }, [thread, key])

  const send = (question: string) => {
    if (!question.trim() || busy) return
    setDraft('')
    void askInThread(key, question, {
      memory: memory.map((f) => f.text),
      getContext: async () => {
        if (contextRef.current == null) {
          try {
            contextRef.current = await buildTrainerContext({ workoutId })
          } catch {
            // A failed snapshot shouldn't block the question — the endpoint
            // says so in the prompt and answers generally.
            contextRef.current = ''
          }
        }
        return contextRef.current
      },
    })
  }

  // New chat emptied the thread — don't carry the old "Saved" note into the next.
  if (saved && !bubbles.length) setSaved(null)

  const onRemember = (fact: string) => {
    addFact(fact)
    setSaved(fact)
    clearRememberChip(key, fact)
  }

  const starters = workoutId ? WORKOUT_STARTERS : STARTERS

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {bubbles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Brain className="mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {workoutId ? 'Ask mid-session' : 'Ask about your training'}
            </h2>
            <p className="mt-1 max-w-[17rem] text-sm text-muted-foreground">
              {workoutId
                ? 'I can see the sets you have already logged today, plus your history and nutrition.'
                : 'I can see your logged lifts, program, goals and food diary. Ask about aches, plateaus, or what to do next.'}
            </p>
            <div className="mt-6 flex w-full flex-col gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-card-foreground active:scale-[0.99]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bubbles.map((b, i) => (
              <div key={i}>
                <div
                  className={cn(
                    'w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm',
                    b.role === 'user'
                      ? 'ml-auto bg-primary text-primary-foreground'
                      : b.error
                        ? 'border border-destructive/40 bg-destructive/10 text-foreground'
                        : 'border border-border bg-card text-card-foreground',
                  )}
                >
                  {b.content || (
                    <span className="inline-flex gap-1 py-1" aria-label="Thinking">
                      <Dot delay="0ms" />
                      <Dot delay="150ms" />
                      <Dot delay="300ms" />
                    </span>
                  )}
                </div>
                {b.remember && (
                  <button
                    type="button"
                    onClick={() => onRemember(b.remember!)}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary active:scale-[0.98]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Remember: {b.remember}
                  </button>
                )}
              </div>
            ))}
            {saved && (
              <p className="text-center text-xs text-muted-foreground">
                Saved to memory.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-end gap-2">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              // Grow with the text, up to ~5 lines.
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder={workoutId ? 'Ask between sets…' : 'Ask about your training…'}
            className="max-h-[120px] min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {busy ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={() => stopThread(key)}
              aria-label="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => send(draft)}
              disabled={!draft.trim()}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] leading-tight text-muted-foreground">
          General training guidance, not medical advice.
        </p>
      </div>
    </>
  )
}

/** Header button: clear a saved conversation. Hidden while there's nothing in it. */
export function NewChatButton({ thread }: { thread: string }) {
  const { bubbles } = useTrainerThread(thread)
  if (!bubbles.length) return null
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        if (confirm('Start a new chat? This conversation will be cleared.')) clearThread(thread)
      }}
      aria-label="New chat"
    >
      <SquarePen className="h-5 w-5" />
    </Button>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  )
}
