// Client half of the Ask-a-trainer chat. Posts the conversation to
// /api/trainer and reads the reply as it streams, so the bubble fills in
// instead of appearing four seconds later.
//
// The endpoint returns plain UTF-8 text on success (it has already turned
// Anthropic's SSE into text) and JSON on failure, so the content-type tells the
// two apart.

import { supabase } from './supabase'

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
const FULL = /\[\[REMEMBER:\s*([\s\S]*?)\]\]/
const MAX_REMEMBER_CHARS = 200

/** Hide a marker the stream is still in the middle of writing, so the raw
 *  "[[REMEM…" never flashes in the bubble. */
function stripTrailingPartial(s: string): string {
  for (let n = Math.min(OPEN.length, s.length); n > 0; n--) {
    if (s.endsWith(OPEN.slice(0, n))) return s.slice(0, s.length - n)
  }
  return s
}

/** The bubble text for a stream so far: everything before the memory marker,
 *  including while that marker is still half-written. Exported for tests. */
export function displayText(raw: string): string {
  return stripTrailingPartial(raw.replace(/\[\[REMEMBER[\s\S]*$/, '')).trimEnd()
}

/** The fact the trainer wants to remember, or null. Exported for tests. */
export function parseRemember(raw: string): string | null {
  const fact = raw.match(FULL)?.[1]?.trim()
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
  // The endpoint spends real money per call, so it only answers signed-in
  // users. Every caller is already behind the app's auth gate, so this is just
  // forwarding the session we have.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to use the trainer.')

  const res = await fetch('/api/trainer', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
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
      detail?: string
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
