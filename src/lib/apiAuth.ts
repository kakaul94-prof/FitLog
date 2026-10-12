import { supabase } from './supabase'

/**
 * Headers for a call to one of our /api functions. They only answer signed-in
 * users (functions/api/_middleware.ts) because each call spends money on an AI
 * provider; every caller is already behind the app's auth gate, so this just
 * forwards the session we have.
 */
export async function apiHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in to use this feature.')
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  }
}
