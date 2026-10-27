// Cloudflare Pages middleware for every /api/* function: only signed-in FitLog
// users get through. Each function spends real money per call (Claude) or AI
// quota (Workers AI), and every real request already comes from behind the
// app's auth gate, so this costs nothing in normal use; it exists because the
// endpoints are otherwise open to anyone who learns the URL.
//
// It validates the bearer token against Supabase rather than checking the JWT
// locally: one extra round trip, but it needs no JWT secret and it honours
// expiry AND sign-out (a signed-out token stops working here at once, while a
// local signature check would accept it until it expires).
//
// Guarded by api-tests/tests/functions/ and api-tests/tests/auth/test_tokens.py.

import * as Sentry from '@sentry/cloudflare'
import { RELEASE } from '../../shared/release'
import { scrubBreadcrumb, scrubEvent } from '../../shared/scrub'

interface Env {
  // Already set on both Pages projects for the browser build. The VITE_ prefix
  // is only a Vite convention for client-side inlining — Functions read the same
  // variables at runtime, so the gate costs no new secrets.
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  // Error tracking (Sentry). Unset locally, in tests and under `wrangler pages
  // dev`, where the SDK then never enters the request path.
  SENTRY_DSN?: string
  SENTRY_ENVIRONMENT?: string
}

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Why the caller may not proceed, or null when they're a signed-in user.
 *  The reasons are specific so a misconfigured deploy is obvious instead of
 *  looking like "you're logged out", but the variable names go to the function
 *  log, not to whoever is calling. */
async function authFailure(env: Env, request: Request): Promise<string | null> {
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  // Fail CLOSED: an unconfigured gate that waves everyone through is worse than
  // a broken feature. The log says exactly what to fix.
  if (!url || !anon) {
    console.error(
      'api: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not readable by this Pages project, so sign-ins cannot be checked',
    )
    return "This feature isn't set up correctly right now. (code: auth-config)"
  }

  const header = request.headers.get('authorization') ?? ''
  const token = /^bearer /i.test(header) ? header.slice(7).trim() : ''
  if (!token) return 'Sign in to use this feature.'

  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: anon },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return 'Your session has expired. Sign in again.'
  } catch {
    return 'Could not verify your session. Check your connection and try again.'
  }
  return null
}

type Context = {
  request: Request
  env: Env
  next: () => Promise<Response>
}

/** The gate: never spend a token on an unauthenticated caller. */
async function gate(context: Context): Promise<Response> {
  const denied = await authFailure(context.env, context.request)
  if (denied) return json({ error: denied }, 401)
  return context.next()
}

// Error tracking around the gate and every /api function. An unhandled throw
// is reported to Sentry, scrubbed first (shared/scrub.ts: no bodies, headers,
// query strings, emails or tokens), tagged with the commit being served, and
// rethrown so the caller still gets Cloudflare's 500. Without a SENTRY_DSN
// (local, tests, `wrangler pages dev`) the SDK is not in the request path at
// all. The SDK needs the nodejs_als compatibility flag on the Pages project
// (AsyncLocalStorage); ci.yml checks the flag before deploying.
const sentry = Sentry.sentryPagesPlugin<Env>((context) => ({
  dsn: context.env.SENTRY_DSN,
  release: RELEASE,
  environment: context.env.SENTRY_ENVIRONMENT || 'production',
  sendDefaultPii: false,
  sampleRate: 1,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubEvent(event),
  beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  initialScope: { tags: { runtime: 'functions' } },
}))

export const onRequest = async (context: Context): Promise<Response> => {
  if (!context.env.SENTRY_DSN) return gate(context)
  const wrapped = { ...context, next: () => gate(context) }
  return sentry(wrapped as unknown as Parameters<typeof sentry>[0])
}
