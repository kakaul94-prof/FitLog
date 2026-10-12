// Client half of the Ask-a-trainer chat. Posts the conversation to
// /api/trainer and reads the reply as it streams, so the bubble fills in
// instead of appearing four seconds later.
//
// The endpoint returns plain UTF-8 text on success (it has already turned
// Anthropic's SSE into text) and JSON on failure, so the content-type tells the
// two apart.

import { apiHeaders } from './apiAuth'

export interface TrainerTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface TrainerReply {
  /** What to show in the bubble — the memory marker already removed. */
  text: string
  /** A fact the trainer wants to remember, or null. Offered, never auto-saved. */
  remember: string | null
}

/** Mirrors REMEMBER_TAG in functions/api/trainer.ts — keep the two in sync. */
const OPEN = '[[REMEMBER'
// Any complete marker, with the space before it, wherever it is.
const MARKER = / ?\[\[REMEMBER:[\s\S]*?\]\]/g
// A marker still being written at the end: no closing ]] after it yet.
const UNCLOSED = /\[\[REMEMBER(?:(?!\]\])[\s\S])*$/
// A marker that is the reply's whole last line: the only place the prompt asks
// the model to put one. Anywhere else it is text the model repeated, e.g. a
// product name from the user's log, and must never become a chip.
const LAST_LINE = /(?:^|\n)[ \t]*\[\[REMEMBER:\s*([^\n]*?)\]\][ \t]*$/
const MAX_REMEMBER_CHARS = 200

/** Hide a marker the stream is still in the middle of writing, so the raw
 *  "[[REMEM…" never flashes in the bubble. */
function stripTrailingPartial(s: string): string {
  for (let n = Math.min(OPEN.length, s.length); n > 0; n--) {
    if (s.endsWith(OPEN.slice(0, n))) return s.slice(0, s.length - n)
  }
  return s
}

/** The bubble text for a stream so far: every complete memory marker removed,
 *  keeping the words around it, and one still being written hidden. Exported
 *  for tests. */
export function displayText(raw: string): string {
  return stripTrailingPartial(raw.replace(MARKER, '').replace(UNCLOSED, '')).trimEnd()
}

/** The fact the trainer wants to remember, or null: only from a marker on the
 *  reply's last line (see LAST_LINE). Exported for tests; guarded by
 *  ai-evals/tests/test_unintended_actions.py. */
export function parseRemember(raw: string): string | null {
  const fact = raw.trimEnd().match(LAST_LINE)?.[1]?.trim()
  if (!fact) return null
  return fact.slice(0, MAX_REMEMBER_CHARS)
}

export async function askTrainer(opts: {
  messages: TrainerTurn[]
  context: string
  memory: string[]
  signal?: AbortSignal
  /** Called with the accumulated display text on every chunk. */
  onText: (text: string) => void
}): Promise<TrainerReply> {
  const res = await fetch('/api/trainer', {
    method: 'POST',
    headers: await apiHeaders(),
    body: JSON.stringify({
      messages: opts.messages,
      context: opts.context,
      memory: opts.memory,
    }),
    signal: opts.signal,
  })

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(data?.error || 'The trainer is unavailable right now.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value, { stream: true })
      opts.onText(displayText(raw))
    }
  } finally {
    reader.releaseLock()
  }
  raw += decoder.decode()

  const text = displayText(raw)
  opts.onText(text)
  if (!text.trim()) throw new Error('The trainer had nothing to say. Try again.')
  return { text, remember: parseRemember(raw) }
}
