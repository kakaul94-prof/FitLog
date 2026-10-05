import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, type TestUser } from './env'

/**
 * A Supabase client signed in as a seeded user, with the same anon key and
 * RLS rules the app itself runs under. Specs use it as the source of truth
 * for what actually reached the database, and to probe RLS directly.
 */
export async function signedInClient(user: TestUser): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw new Error(`Sign-in failed for ${user.email}: ${error.message}`)
  return client
}

/** A client with no session at all (the `anon` role). */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
