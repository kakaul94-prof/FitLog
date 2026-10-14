// Checks: did a request do what the journey expected? A failed check records a
// failed `checks{scope:journey}` sample (budgeted in config/thresholds.ts) and
// never aborts the iteration, so a journey keeps going the way a user would.
import { check } from 'k6'
import type { RefinedResponse, ResponseType } from 'k6/http'
import type { EndpointName } from '../config/endpoints.ts'

type Response = RefinedResponse<ResponseType | undefined>

const WARN_LIMIT = 3 // per VU: enough to see what went wrong, not a flood under stress
let warned = 0

function warn(name: EndpointName, res: Response, what: string): void {
  if (warned++ >= WARN_LIMIT) return
  const body = typeof res.body === 'string' ? res.body.slice(0, 200) : ''
  console.warn(`${name}: ${what} (status ${res.status}) ${body}`)
}

export function expectStatus(res: Response, name: EndpointName, status = 200): boolean {
  const ok = check(res, { [`${name} → ${status}`]: (r) => r.status === status }, { scope: 'journey', name })
  if (!ok) warn(name, res, `expected ${status}`)
  return ok
}

/** Parse a JSON body, or null when it isn't JSON. */
export function parse<T>(res: Response): T | null {
  if (typeof res.body !== 'string' || !res.body) return null
  try {
    return JSON.parse(res.body) as T
  } catch {
    return null
  }
}

/** A 200 whose body is a JSON array with at least `min` rows. */
export function expectRows<T>(res: Response, name: EndpointName, min = 0): T[] {
  const rows = res.status === 200 ? parse<T[]>(res) : null
  const ok = check(res, { [`${name} → ${min ? `≥${min} rows` : 'rows'}`]: () => Array.isArray(rows) && rows.length >= min }, { scope: 'journey', name })
  if (!ok) warn(name, res, `expected a JSON array with ≥${min} rows`)
  return Array.isArray(rows) ? rows : []
}

/** A `status` whose body is one JSON object (PostgREST's object representation). */
export function expectRow<T>(res: Response, name: EndpointName, status = 200): T | null {
  const row = res.status === status ? parse<T>(res) : null
  const ok = check(res, { [`${name} → ${status} + row`]: () => row !== null && typeof row === 'object' && !Array.isArray(row) }, { scope: 'journey', name })
  if (!ok) warn(name, res, `expected ${status} with one JSON object`)
  return row
}
