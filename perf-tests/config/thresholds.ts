// Performance budgets: what "fast enough" means for each endpoint group, and
// the k6 thresholds that enforce them. A breach fails the run (exit code 99),
// except in the report-only scenarios (stress, spike), where run.sh reports it
// and exits 0 — the curve is the result there.
//
// If a budget is breached by a real slow query, missing index or N+1, the fix
// goes in the app, test-first, with before/after numbers. The budget stays.
import { ENDPOINTS, type Op } from './endpoints.ts'
import type { Profile } from './profiles.ts'

export interface Budget {
  p95: number
  p99: number
  why: string
}

/** Server-side latency budgets in ms, measured from k6 on the same machine, so
 *  they exclude real-world network time (50–150 ms on a phone). */
export const LATENCY: Record<Exclude<Op, 'fn' | 'signin'>, Budget> = {
  search: {
    p95: 200,
    p99: 500,
    why: 'Food search is typeahead: a result that lands after the next keystroke is wasted, and the picker fires a query per keystroke.',
  },
  read: {
    p95: 250,
    p99: 600,
    why: 'A tab should open in about a second on a phone: after ~150 ms of network and ~400 ms of rendering five parallel queries, the slowest may take ~250 ms server-side.',
  },
  write: {
    p95: 400,
    p99: 1000,
    why: 'Writes are optimistic in the UI, so they only have to land before the next read. They pay for the RLS check, index updates and row locks, hence more room than reads.',
  },
  auth: {
    p95: 500,
    p99: 1000,
    why: 'Token refresh runs in the background every ~55 min per session; it must not stall the next request, but nobody is watching it.',
  },
}

/** /api/trainer streams, so time-to-first-byte is what the user feels. Claude
 *  is stubbed, which leaves only our overhead: the sign-in check against
 *  GoTrue and building the prompt. */
export const FN_TTFB = {
  p95: 1000,
  why: 'With Claude stubbed, time-to-first-byte is the sign-in check (one GoTrue round trip) plus prompt assembly; a second is already generous for that.',
}

/** Soak: p95 of the last third may not exceed p95 of the first third by more than this. */
export const SOAK_DRIFT_MAX = 1.25

/** The share of checks that may fail without failing the run (a failed check
 *  means an unexpected body or status, not necessarily an HTTP error). */
export const CHECK_PASS_MIN = 0.99

/** Stress and spike abort themselves once errors stay above this: past that
 *  point the numbers describe a dead stack, not a slow one. */
export const ABORT_ERROR_RATE = 0.1

/** CI runs the smoke scenario on a shared runner whose speed varies 3× between
 *  runs. There, latency budgets are relaxed to catch regressions of kind, not
 *  of degree: the real numbers come from the nightly run and local runs. */
export const LAX = { p95: 1000, p99: 2500, fnTtfb: 3000 }

type Threshold = string | { threshold: string; abortOnFail?: boolean; delayAbortEval?: string }
export type Thresholds = Record<string, Threshold[]>

export function thresholdsFor(profile: Profile, lax = __ENV.PERF_LAX === '1'): Thresholds {
  const t: Thresholds = {}
  const err = `rate<=${profile.errorBudget}`
  const latency = (b: Budget) => (lax ? [`p(95)<${LAX.p95}`, `p(99)<${LAX.p99}`] : [`p(95)<${b.p95}`, `p(99)<${b.p99}`])

  // Per endpoint group: latency and error rate.
  for (const [op, budget] of Object.entries(LATENCY) as [keyof typeof LATENCY, Budget][]) {
    t[`http_req_duration{op:${op}}`] = latency(budget)
    t[`http_req_failed{op:${op}}`] = [err]
  }
  t['http_req_waiting{op:fn}'] = [`p(95)<${lax ? LAX.fnTtfb : FN_TTFB.p95}`]
  t['http_req_failed{op:fn}'] = [err]

  // Per endpoint: its group's p95, so one slow query can't hide behind the group.
  for (const [name, op] of Object.entries(ENDPOINTS)) {
    if (op === 'signin' || op === 'fn') continue
    t[`http_req_duration{name:${name}}`] = [`p(95)<${lax ? LAX.p95 : LATENCY[op].p95}`]
  }

  // The journeys as a whole (setup and teardown traffic is tagged scope:setup
  // and stays out of every budget).
  t['http_req_failed{scope:journey}'] = profile.reportOnly
    ? [err, { threshold: `rate<${ABORT_ERROR_RATE}`, abortOnFail: true, delayAbortEval: '90s' }]
    : [err]
  t['checks{scope:journey}'] = [profile.errorBudget === 0 ? 'rate==1' : `rate>=${CHECK_PASS_MIN}`]
  t['http_reqs{scope:journey}'] = ['count>0']
  t['iterations'] = ['count>0']

  // Surfaces the first- and last-third sub-metrics in the summary so the soak
  // drift check (scripts/check-run.mjs) can compare them. Never fails.
  t['http_req_duration{scope:journey,phase:first}'] = ['p(95)>=0']
  t['http_req_duration{scope:journey,phase:last}'] = ['p(95)>=0']
  return t
}
