import { describe, expect, it } from 'vitest'
import {
  asHistory,
  MAX_STORED_BUBBLES,
  parseThreads,
  pruneThreads,
  storableBubbles,
  THREAD_TTL_MS,
  type ChatBubble,
} from './trainerThreads'

const q = (content: string): ChatBubble => ({ role: 'user', content })
const a = (content: string, extra: Partial<ChatBubble> = {}): ChatBubble => ({
  role: 'assistant',
  content,
  ...extra,
})

describe('storableBubbles', () => {
  it('drops failed and empty replies, keeps remember chips', () => {
    const out = storableBubbles([
      q('knee hurts'),
      a('Network down', { error: true }),
      q('knee hurts'),
      a('Box squat.', { remember: 'left knee hurts on squats' }),
      q('and bench?'),
      a('   '),
    ])
    expect(out).toEqual([
      q('knee hurts'),
      q('knee hurts'),
      a('Box squat.', { remember: 'left knee hurts on squats' }),
      q('and bench?'),
    ])
  })

  it('keeps only the most recent MAX_STORED_BUBBLES', () => {
    const many = Array.from({ length: MAX_STORED_BUBBLES + 5 }, (_, i) => q(`m${i}`))
    const out = storableBubbles(many)
    expect(out).toHaveLength(MAX_STORED_BUBBLES)
    expect(out[0].content).toBe('m5')
  })
})

describe('asHistory', () => {
  it('sends role + text only', () => {
    expect(asHistory([q('hi'), a('yo', { remember: 'x' }), a('bad', { error: true })])).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo' },
    ])
  })
})

describe('parseThreads', () => {
  it('round-trips saved threads', () => {
    const threads = { general: { bubbles: [q('hi'), a('yo')], updatedAt: 5 } }
    expect(parseThreads(JSON.stringify(threads))).toEqual(threads)
  })

  it.each([null, '', 'not json', '[]', '"x"', 'null'])('treats %j as empty', (raw) => {
    expect(parseThreads(raw)).toEqual({})
  })

  it('skips malformed threads and bubbles instead of throwing', () => {
    const raw = JSON.stringify({
      noTime: { bubbles: [q('hi')] },
      notArray: { bubbles: 'hi', updatedAt: 1 },
      nothingLeft: { bubbles: [{ role: 'system', content: 'x' }], updatedAt: 1 },
      mixed: { bubbles: [q('ok'), { role: 'user' }, 42, a('fine')], updatedAt: 1 },
    })
    expect(parseThreads(raw)).toEqual({ mixed: { bubbles: [q('ok'), a('fine')], updatedAt: 1 } })
  })
})

describe('pruneThreads', () => {
  it('drops threads untouched for the TTL, keeps the rest', () => {
    const now = 1_000_000_000_000
    const threads = {
      'workout:old': { bubbles: [q('a')], updatedAt: now - THREAD_TTL_MS },
      'workout:recent': { bubbles: [q('b')], updatedAt: now - THREAD_TTL_MS + 1 },
      general: { bubbles: [q('c')], updatedAt: now },
    }
    expect(Object.keys(pruneThreads(threads, now))).toEqual(['workout:recent', 'general'])
  })
})
