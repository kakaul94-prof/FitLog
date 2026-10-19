// Small random helpers. k6's runtime has WebCrypto, so ids are real v4 UUIDs
// (the app also generates row ids client-side, see lib/idempotent.ts).
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** A short base-36 token, for run ids and passwords. */
export function randomId(length = 6): string {
  let out = ''
  while (out.length < length) out += Math.random().toString(36).slice(2)
  return out.slice(0, length)
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** A random integer in [min, max]. */
export function between(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}
