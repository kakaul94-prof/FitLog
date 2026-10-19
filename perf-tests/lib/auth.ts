// Supabase Auth (GoTrue) the way the app uses it: the password sign-in and the
// refresh-token grant, both with the public anon key. Each virtual user holds
// its own session, so two VUs on the same seeded account never share a refresh
// token (rotation would invalidate one of them).
import http from 'k6/http'
import { sleep } from 'k6'
import type { Env } from './env.ts'
import { tagsFor, type Scope } from './rest.ts'

export interface Session {
  userId: string
  email: string
  password: string
  accessToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
}

/** Refresh this long before expiry, as supabase-js does in the background. */
const REFRESH_AHEAD_S = 300

interface TokenBody {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  user: { id: string }
}

function tokenRequest(env: Env, grant: 'password' | 'refresh_token', body: Record<string, string>, name: 'auth.signin' | 'auth.refresh', scope: Scope) {
  return http.post(`${env.supabaseUrl}/auth/v1/token?grant_type=${grant}`, JSON.stringify(body), {
    headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    tags: tagsFor(name, scope),
  })
}

function toSession(body: TokenBody, email: string, password: string): Session {
  return {
    userId: body.user.id,
    email,
    password,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at ?? Math.floor(Date.now() / 1000) + body.expires_in,
  }
}

/** Sign in, backing off on 429 (the local stack allows 300 sign-ins per 5 min
 *  per IP, which a spike of 250 users all signing in at once can brush) and on
 *  5xx. Anything else is a real failure. */
export function signIn(env: Env, email: string, password: string, scope: Scope = 'journey', attempts = 6): Session {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = tokenRequest(env, 'password', { email, password }, 'auth.signin', scope)
    if (res.status === 200) return toSession(res.json() as unknown as TokenBody, email, password)
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`sign-in failed for ${email}: ${res.status} ${String(res.body).slice(0, 200)}`)
    }
    sleep(Math.min(30, 2 ** attempt) + Math.random())
  }
  throw new Error(`sign-in for ${email} kept failing (${attempts} attempts)`)
}

export function refresh(env: Env, session: Session, scope: Scope = 'journey'): Session {
  const res = tokenRequest(env, 'refresh_token', { refresh_token: session.refreshToken }, 'auth.refresh', scope)
  if (res.status !== 200) {
    // A rotated-away refresh token (or a restarted stack) means a new sign-in.
    return signIn(env, session.email, session.password, scope)
  }
  return toSession(res.json() as unknown as TokenBody, session.email, session.password)
}

/** The session, refreshed if it is about to expire (matters only in long soaks). */
export function ensureFresh(env: Env, session: Session, scope: Scope = 'journey'): Session {
  return session.expiresAt - Date.now() / 1000 < REFRESH_AHEAD_S ? refresh(env, session, scope) : session
}
