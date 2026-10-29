// One signed-in session per virtual user, made on its first iteration and kept
// for the rest of the run (refreshed before it expires). VU n uses seeded user
// n mod pool: two VUs on the same account hold separate sessions, exactly like
// the same person on a phone and a laptop.
//
// Sign-ins happen as VUs ramp up rather than all at once in setup, which keeps
// a spike of 250 users inside the local stack's 300-sign-ins-per-5-minutes
// limit, and means the ramp itself is part of what is measured.
import exec from 'k6/execution'
import { ensureFresh, signIn, type Session } from './auth.ts'
import type { Env } from './env.ts'
import type { Caller } from './rest.ts'
import type { PoolUser, SetupData } from './seed.ts'

/** What a journey gets: who is signed in, how to call the API as them, and the date. */
export interface Ctx {
  env: Env
  user: PoolUser
  session: Session
  caller: Caller
  /** The seeded day (SetupData.today), not the clock's: the clock can pass midnight mid-run. */
  today: string
}

let session: Session | null = null
let user: PoolUser | null = null

export function contextFor(env: Env, data: SetupData): Ctx {
  if (!user || !session) {
    user = data.users[(exec.vu.idInTest - 1) % data.users.length]
    session = signIn(env, user.email, user.password)
  } else {
    session = ensureFresh(env, session)
  }
  return {
    env,
    user,
    session,
    caller: { baseUrl: env.supabaseUrl, apikey: env.anonKey, bearer: session.accessToken },
    today: data.today,
  }
}
