import { useSyncExternalStore } from 'react'
import { askTrainer } from '@/lib/trainer'
import {
  asHistory,
  parseThreads,
  pruneThreads,
  storableBubbles,
  type ChatBubble,
  type StoredThreads,
} from '@/lib/trainerThreads'

// Ask-a-trainer conversations, held OUTSIDE the chat component so closing the
// chat (the mid-workout overlay, or leaving /lift/trainer) neither wipes the
// conversation nor cancels a reply that's still streaming: reopen and it's
// there. Saved threads also survive the app being killed in the background.
//
// Keys: `workout:<id>` (one per workout), `general` (the Lift-tab Ask page).
// Keys starting `scratch:` are never saved — a one-off chat, e.g. the
// pre-workout check-in's.

const STORAGE_KEY = 'trainer_chats'
const SCRATCH = 'scratch:'

/** Only this many turns are sent; the endpoint keeps the last 12 anyway. */
const MAX_SENT_TURNS = 24

export const workoutThread = (workoutId: string) => `workout:${workoutId}`
export const GENERAL_THREAD = 'general'
export const scratchThread = (id: string) => `${SCRATCH}${id}`

export interface ThreadState {
  bubbles: ChatBubble[]
  busy: boolean
}

const threads = new Map<string, ThreadState>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let saved: StoredThreads | null = null

function savedThreads(): StoredThreads {
  if (!saved) {
    try {
      saved = pruneThreads(parseThreads(localStorage.getItem(STORAGE_KEY)), Date.now())
    } catch {
      saved = {}
    }
  }
  return saved
}

function persist(key: string) {
  if (key.startsWith(SCRATCH)) return
  const all = savedThreads()
  const bubbles = storableBubbles(getThread(key).bubbles)
  if (bubbles.length) all[key] = { bubbles, updatedAt: Date.now() }
  else delete all[key]
  saved = pruneThreads(all, Date.now())
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    /* storage full or unavailable — the chat still works this session */
  }
}

function getThread(key: string): ThreadState {
  let t = threads.get(key)
  if (!t) {
    t = { bubbles: savedThreads()[key]?.bubbles ?? [], busy: false }
    threads.set(key, t)
  }
  return t
}

/** Replace a thread's state. `save` is off for per-chunk stream updates. */
function update(key: string, fn: (t: ThreadState) => ThreadState, save = true) {
  threads.set(key, fn(getThread(key)))
  if (save) persist(key)
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useTrainerThread(key: string): ThreadState {
  return useSyncExternalStore(subscribe, () => getThread(key))
}

/** Ask a question in a thread. Runs to completion even if the chat closes. */
export async function askInThread(
  key: string,
  question: string,
  opts: { getContext: () => Promise<string>; memory: string[] },
) {
  const text = question.trim()
  const thread = getThread(key)
  if (!text || thread.busy) return

  const history = [
    ...asHistory(thread.bubbles),
    { role: 'user' as const, content: text },
  ].slice(-MAX_SENT_TURNS)
  update(key, (t) => ({
    busy: true,
    bubbles: [...t.bubbles, { role: 'user', content: text }, { role: 'assistant', content: '' }],
  }))

  const controller = new AbortController()
  controllers.set(key, controller)
  // False once New chat (or closing a scratch chat) has dropped this reply, so
  // a late chunk can't land in the next conversation.
  const live = () => controllers.get(key) === controller

  // Replace the streaming placeholder in place — it's always the last bubble.
  const patch = (fields: Partial<ChatBubble>) => {
    if (!live()) return
    update(
      key,
      (t) => ({
        ...t,
        bubbles: t.bubbles.map((x, i) => (i === t.bubbles.length - 1 ? { ...x, ...fields } : x)),
      }),
      false,
    )
  }

  try {
    const reply = await askTrainer({
      messages: history,
      context: await opts.getContext(),
      memory: opts.memory,
      signal: controller.signal,
      onText: (t) => patch({ content: t }),
    })
    patch({ content: reply.text, remember: reply.remember })
  } catch (e) {
    if (!live()) return
    if (controller.signal.aborted) {
      // Keep whatever streamed before Stop; drop it if nothing arrived.
      update(
        key,
        (t) => ({
          ...t,
          bubbles: t.bubbles[t.bubbles.length - 1]?.content.trim()
            ? t.bubbles
            : t.bubbles.slice(0, -1),
        }),
        false,
      )
    } else {
      patch({
        content: e instanceof Error ? e.message : 'Something went wrong.',
        error: true,
      })
    }
  } finally {
    if (live()) {
      controllers.delete(key)
      update(key, (t) => ({ ...t, busy: false }))
    }
  }
}

export function stopThread(key: string) {
  controllers.get(key)?.abort()
}

/** The "Remember" chip was used: clear it from that bubble. */
export function clearRememberChip(key: string, fact: string) {
  update(key, (t) => ({
    ...t,
    bubbles: t.bubbles.map((x) => (x.remember === fact ? { ...x, remember: null } : x)),
  }))
}

/** New chat: stop any reply and empty the thread. */
export function clearThread(key: string) {
  controllers.get(key)?.abort()
  controllers.delete(key)
  update(key, () => ({ bubbles: [], busy: false }))
}

/** Forget a scratch thread when its chat closes (the old, unsaved behaviour). */
export function discardThread(key: string) {
  controllers.get(key)?.abort()
  controllers.delete(key)
  threads.delete(key)
}
