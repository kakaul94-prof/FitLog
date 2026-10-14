// Saved Ask-a-trainer conversations: the pure half (parse / tidy / prune), kept
// apart from the localStorage + React store in features/trainer so it's
// unit-testable in node. One thread per workout plus one for the Lift-tab Ask
// page; they live on the device only.

import type { TrainerTurn } from './trainer'

export interface ChatBubble extends TrainerTurn {
  /** Set on an assistant turn that proposed something to remember. */
  remember?: string | null
  /** Assistant turn that failed — shown as a warning, never saved or resent. */
  error?: boolean
}

export interface StoredThread {
  bubbles: ChatBubble[]
  /** ms since epoch of the last change; drives the prune. */
  updatedAt: number
}

export type StoredThreads = Record<string, StoredThread>

/** A thread untouched this long is dropped, so last week's "my knee hurts"
 *  doesn't colour today's answers. */
export const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Per-thread cap on what's kept on the device. The endpoint only ever reads
 *  the last few turns; this just bounds storage. */
export const MAX_STORED_BUBBLES = 100

/** Only real turns: errors and empty (stopped / still-streaming) replies go. */
export function storableBubbles(bubbles: ChatBubble[]): ChatBubble[] {
  return bubbles
    .filter((b) => !b.error && b.content.trim())
    .slice(-MAX_STORED_BUBBLES)
}

/** What goes back to the model: real turns, role + text only. */
export const asHistory = (bubbles: ChatBubble[]): TrainerTurn[] =>
  storableBubbles(bubbles).map(({ role, content }) => ({ role, content }))

const isBubble = (b: unknown): b is ChatBubble => {
  const x = b as ChatBubble | null
  return (
    !!x &&
    (x.role === 'user' || x.role === 'assistant') &&
    typeof x.content === 'string'
  )
}

/** Read the saved blob, dropping anything malformed rather than throwing — a
 *  corrupt entry must never break the chat. */
export function parseThreads(raw: string | null): StoredThreads {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: StoredThreads = {}
  for (const [key, t] of Object.entries(data as Record<string, unknown>)) {
    const thread = t as Partial<StoredThread> | null
    if (!thread || !Array.isArray(thread.bubbles) || typeof thread.updatedAt !== 'number')
      continue
    const bubbles = storableBubbles(thread.bubbles.filter(isBubble))
    if (bubbles.length) out[key] = { bubbles, updatedAt: thread.updatedAt }
  }
  return out
}

/** Drop threads untouched for THREAD_TTL_MS. */
export function pruneThreads(threads: StoredThreads, now: number): StoredThreads {
  const out: StoredThreads = {}
  for (const [key, t] of Object.entries(threads))
    if (now - t.updatedAt < THREAD_TTL_MS) out[key] = t
  return out
}
