import { useEffect, useRef, useState } from 'react'
import { Brain, Plus, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildTrainerContext } from '@/lib/trainerContext'
import { askTrainer, type TrainerTurn } from '@/lib/trainer'
import { useAddTrainerFact, useTrainerMemory } from '@/features/trainer/useTrainerMemory'
import { cn } from '@/lib/utils'

// The Ask-a-trainer conversation: message list + composer, no header. Lives in
// two places, which is why it's a component rather than page-local state —
// TrainerPage (/lift/trainer) and a full-screen overlay on WorkoutPage, where
// it must NOT unmount the workout underneath it mid-session.
//
// Expects a flex-column parent with a bounded height; it fills what it's given.

interface Bubble extends TrainerTurn {
  /** Set on the last assistant turn when it proposed something to remember. */
  remember?: string | null
  /** Assistant turn that failed — rendered as a warning, not saved as history. */
  error?: boolean
}

/** Only real turns go back to the model; errors and empty streams are dropped. */
const asHistory = (bubbles: Bubble[]): TrainerTurn[] =>
  bubbles
    .filter((b) => !b.error && b.content.trim())
    .map(({ role, content }) => ({ role, content }))

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

export function TrainerChat({ workoutId }: { workoutId?: string }) {
  const memory = useTrainerMemory()
  const { add: addFact } = useAddTrainerFact()

  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  // The training snapshot is a handful of queries and stable for the life of
  // the chat, so it's built once on the first question.
  const contextRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stick to the bottom as the reply streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [bubbles])

  // Abandon an in-flight answer if the chat closes.
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    setDraft('')
    setBusy(true)

    const history = [...asHistory(bubbles), { role: 'user' as const, content: text }]
    setBubbles((b) => [
      ...b,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ])

    // Replace the streaming placeholder in place — it's always the last bubble.
    const patch = (fields: Partial<Bubble>) =>
      setBubbles((b) =>
        b.map((x, i) => (i === b.length - 1 ? { ...x, ...fields } : x)),
      )

    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (contextRef.current == null) {
        try {
          contextRef.current = await buildTrainerContext({ workoutId })
        } catch {
          // A failed snapshot shouldn't block the question — the endpoint says
          // so in the prompt and answers generally.
          contextRef.current = ''
        }
      }
      const reply = await askTrainer({
        messages: history,
        context: contextRef.current,
        memory: memory.map((f) => f.text),
        signal: controller.signal,
        onText: (t) => patch({ content: t }),
      })
      patch({ content: reply.text, remember: reply.remember })
    } catch (e) {
      if (controller.signal.aborted) {
        // Keep whatever streamed before Stop; drop it if nothing arrived.
        setBubbles((b) => (b[b.length - 1]?.content.trim() ? b : b.slice(0, -1)))
      } else {
        patch({
          content: e instanceof Error ? e.message : 'Something went wrong.',
          error: true,
        })
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const onRemember = (fact: string) => {
    addFact(fact)
    setSaved(fact)
    setBubbles((b) =>
      b.map((x) => (x.remember === fact ? { ...x, remember: null } : x)),
    )
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
                  onClick={() => void send(s)}
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
                void send(draft)
              }
            }}
            placeholder={workoutId ? 'Ask between sets…' : 'Ask about your training…'}
            className="max-h-[120px] min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {busy ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => void send(draft)}
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

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  )
}
