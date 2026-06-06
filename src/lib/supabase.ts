import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// Valid-format placeholders so createClient() doesn't throw before the user
// adds real keys. The client simply won't reach a backend until configured.
const safeUrl = url || 'https://placeholder.supabase.co'
const safeKey = anonKey || 'placeholder-anon-key'

if (!isSupabaseConfigured) {
  // Not fatal — the app shell still renders. Set these in .env (local)
  // and in Cloudflare Pages env vars (production) to enable login/data.
  console.warn(
    '[FitLog] Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// Dev-only: expose the client for quick console / automated testing.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __supabase?: typeof supabase }).__supabase =
    supabase
}
