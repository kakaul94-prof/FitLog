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

interface Env {
  // Already set on both Pages projects for the browser build. The VITE_ prefix
  // is only a Vite convention for client-side inlining — Functions read the same
  // variables at runtime, so the gate costs no new secrets.
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

const json = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Why the caller may not proceed, or null when they're a signed-in user.
 *  The reasons are specific so a misconfigured deploy is obvious instead of
 *  looking like "you're logged out". */
async function authFailure(env: Env, request: Request): Promise<string | null> {
  const url = env.VITE_SUPABASE_URL
  const anon = env.VITE_SUPABASE_ANON_KEY
  // Fail CLOSED: an unconfigured gate that waves everyone through is worse than
  // a broken feature, and this message says exactly what to fix.
  if (!url || !anon)
    return 'This feature cannot verify sign-ins (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not readable by this Pages project).'

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

export const onRequest = async (context: {
  request: Request
  env: Env
  next: () => Promise<Response>
}): Promise<Response> => {
  // Gate first: never spend a token on an unauthenticated caller.
  const denied = await authFailure(context.env, context.request)
  if (denied) return json({ error: denied }, 401)
  return context.next()
}
