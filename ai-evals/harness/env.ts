// Must be the harness's FIRST import. src/lib/supabase.ts reads import.meta.env
// as it loads, and build.mjs maps import.meta.env onto this object, so the
// app's client points at the local test stack instead of a Vite-inlined URL.
const env = process.env

;(globalThis as Record<string, unknown>).__FITLOG_ENV__ = {
  VITE_SUPABASE_URL: env.SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
  DEV: false,
  PROD: true,
  MODE: 'ai-evals',
}
