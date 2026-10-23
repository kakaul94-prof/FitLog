// Scrubbing for everything that leaves the app for Sentry. FitLog holds health
// data, so an error report may carry what went wrong, never what the user ate,
// weighs or is called. Pure and dependency-free: shared by the browser
// (src/lib/monitoring.ts) and the Pages Functions (functions/api/_middleware.ts),
// proven in shared/scrub.test.ts.
//
// The rules, in one place:
// - no request bodies, cookies, query strings or auth headers, ever;
// - no user object (Sentry would attach an id or an IP address);
// - no console breadcrumbs (they echo whatever the app logged);
// - emails, JWTs, Supabase keys and bearer tokens become placeholders, in
//   messages, exception values, breadcrumbs, extras and contexts alike;
// - quantities with a food or body unit (182.4 lb, 650 kcal, 30 g) and Postgres
//   row values ("Key (food_name)=(Oats)") become placeholders;
// - DOM breadcrumbs lose aria-label, title, alt and value text (the diary's
//   rows and the calorie ring are labelled with what was eaten);
// - extras and contexts drop any key that smells like a body, a credential or
//   logged data (food, weight, nutrients, notes, trainer memory and messages).
// Stack traces are left whole: file, function and line are what make a report
// useful, and none of them is personal.
//
// The limit: a bare food name inside free text ("saving Oats failed") is not
// recognisable by any rule, so the app's own error messages must never
// interpolate what the user logged; the database's messages (row values in
// "=(…)") and the UI's labels are covered.

export const REDACTED = '[redacted]'

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g
const SB_KEY = /\bsb_(?:publishable|secret)_[\w-]+/g
const BEARER = /\b(bearer\s+)[\w.~+/=-]+/gi
const QUANTITY = /\b\d+(?:[.,]\d+)?\s?(?:kcal|cal|calories|lbs?|kg|g|mg|mcg|µg|ug|iu|oz|ml|cm)\b/gi
const PG_VALUES = /=\([^)]*\)/g
const DOM_TEXT_ATTRS = /\b(aria-label|title|alt|placeholder|value)=(["'])(?:(?!\2).)*\2/g
const SENSITIVE_KEY =
  /pass(word)?|token|secret|auth|cookie|session|email|body|payload|food|weight|nutrient|note|memory|messages?|context|snapshot|phone|address|birth/i
const SAFE_HEADERS = new Set(['user-agent', 'accept', 'accept-language', 'content-type', 'content-length', 'referer'])
const MAX_DEPTH = 6

export function redactText(text: string): string {
  return text
    .replace(BEARER, `$1${REDACTED}`)
    .replace(JWT, '[jwt]')
    .replace(SB_KEY, '[key]')
    .replace(EMAIL, '[email]')
    .replace(PG_VALUES, `=(${REDACTED})`)
    .replace(QUANTITY, '[quantity]')
}

/** The URL without its query string or fragment: PostgREST filters carry food names. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut < 0 ? url : url.slice(0, cut)
}

/** Strings redacted, sensitive keys dropped, recursively and bounded. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value)
  if (value == null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(v, depth + 1)
  }
  return out
}

// Structural types: just what is read or written here, so Sentry's own event
// types (browser and Cloudflare alike) are assignable without importing them.
export interface ScrubbableBreadcrumb {
  category?: string
  message?: string
  data?: Record<string, unknown>
}

export interface ScrubbableRequest {
  url?: string
  query_string?: unknown
  data?: unknown
  cookies?: unknown
  env?: unknown
  headers?: Record<string, string>
}

export interface ScrubbableEvent {
  message?: string
  logentry?: { message?: string; params?: unknown }
  transaction?: string
  request?: ScrubbableRequest
  user?: unknown
  breadcrumbs?: ScrubbableBreadcrumb[] | { values?: ScrubbableBreadcrumb[] }
  exception?: { values?: { value?: string; stacktrace?: { frames?: { vars?: unknown }[] } }[] }
  extra?: Record<string, unknown>
  contexts?: Record<string, unknown>
  tags?: Record<string, unknown>
}

/** Drops console breadcrumbs; strips URLs, bodies and labelled text from the rest. */
export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T | null {
  if (crumb.category === 'console') return null
  if (typeof crumb.message === 'string') {
    const text = crumb.category?.startsWith('ui.') ? crumb.message.replace(DOM_TEXT_ATTRS, `$1=$2${REDACTED}$2`) : crumb.message
    crumb.message = redactText(text)
  }
  if (crumb.data) {
    for (const key of Object.keys(crumb.data)) {
      if (/^(request_body|response_body|body|payload|input|params|headers|cookies?|arguments)$/i.test(key)) delete crumb.data[key]
    }
    for (const [key, value] of Object.entries(crumb.data)) {
      if (typeof value !== 'string') continue
      crumb.data[key] = key === 'url' || key === 'from' || key === 'to' ? stripQuery(value) : redactText(value)
    }
  }
  return crumb
}

/** Scrubs an event in place and returns it, so it can be the whole beforeSend. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  delete event.user

  if (event.request) {
    const r = event.request
    delete r.data
    delete r.cookies
    delete r.query_string
    delete r.env
    if (typeof r.url === 'string') r.url = stripQuery(r.url)
    if (r.headers) {
      const kept: Record<string, string> = {}
      for (const [name, value] of Object.entries(r.headers)) {
        const key = name.toLowerCase()
        if (!SAFE_HEADERS.has(key)) continue
        kept[name] = key === 'referer' ? stripQuery(String(value)) : String(value)
      }
      r.headers = kept
    }
  }

  if (typeof event.message === 'string') event.message = redactText(event.message)
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') event.logentry.message = redactText(event.logentry.message)
    delete event.logentry.params
  }
  if (typeof event.transaction === 'string') event.transaction = stripQuery(event.transaction)

  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = redactText(ex.value)
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars
  }

  if (event.breadcrumbs) {
    const list = Array.isArray(event.breadcrumbs) ? event.breadcrumbs : (event.breadcrumbs.values ?? [])
    const kept = list.map((c) => scrubBreadcrumb(c)).filter((c): c is ScrubbableBreadcrumb => c !== null)
    if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = kept
    else event.breadcrumbs.values = kept
  }

  if (event.extra) event.extra = redactValue(event.extra) as Record<string, unknown>
  if (event.contexts) event.contexts = redactValue(event.contexts) as Record<string, unknown>
  if (event.tags) event.tags = redactValue(event.tags) as Record<string, unknown>

  return event
}
