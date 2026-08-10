import type { HrSamples } from '@/lib/database.types'

/**
 * The recorder hands a finished heart-rate session to the review screen. It's
 * far too big for a query string (a downsampled hour is still ~720 numbers), so
 * it rides in sessionStorage and the URL just carries `?hr=1`. sessionStorage
 * rather than a module variable so a reload on the review screen doesn't lose
 * the session you just recorded.
 */

const KEY = 'fitlog.hrHandoff'

export interface HrHandoff {
  samples: HrSamples
  avg: number | null
  max: number | null
  /** Seconds in zones 1–5. */
  zoneSeconds: number[]
  /** Whichever zone held the most time — becomes the entry's `zone`. */
  zone: number | null
}

export function stashHrSession(h: HrHandoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(h))
  } catch {
    /* nothing to do — the review screen just won't show a curve */
  }
}

/** Read the handed-off session. Left in place so a reload can read it again;
 * clearHrSession() drops it once the entry is saved or abandoned. */
export function peekHrSession(): HrHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HrHandoff) : null
  } catch {
    return null
  }
}

export function clearHrSession() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
