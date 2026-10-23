import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Target } from '../env'

/**
 * The monitor account's own view of the database, over REST with the same
 * anon key and RLS the app uses: it can read and delete its rows and nobody
 * else's, so the sweep below cannot touch a real user's diary even by mistake.
 */
export async function monitorDb(t: Target): Promise<SupabaseClient> {
  const db = createClient(t.supabaseUrl, t.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await db.auth.signInWithPassword({ email: t.email, password: t.password })
  if (error) throw new Error(`REST sign-in as the monitor account failed: ${error.message}`)
  return db
}

/** Every entry the canary logs is named like this, so leftovers are recognisable and safe to delete. */
export const CANARY_PREFIX = 'Canary check'

export interface CanaryEntry {
  id: string
  food_name: string
  meal: string
  entry_date: string
  nutrients: Record<string, number> | null
}

export async function canaryEntries(db: SupabaseClient): Promise<CanaryEntry[]> {
  const { data, error } = await db
    .from('diary_entries')
    .select('id, food_name, meal, entry_date, nutrients')
    .like('food_name', `${CANARY_PREFIX}%`)
  if (error) throw new Error(`reading the canary's entries failed: ${error.message}`)
  return (data ?? []) as CanaryEntry[]
}

/**
 * Deletes every canary entry the monitor owns. Before a run, so a crashed
 * earlier run can't fail this one; after, so nothing is left behind.
 */
export async function sweep(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from('diary_entries')
    .delete()
    .like('food_name', `${CANARY_PREFIX}%`)
    .select('id')
  if (error) throw new Error(`sweeping the canary's entries failed: ${error.message}`)
  return data?.length ?? 0
}
