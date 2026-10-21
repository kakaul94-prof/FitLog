import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Consumer-driven contract tests (contracts/). Kept apart from vitest.config.ts
// so `npm test` stays the fast pure-logic suite, and so the app's Supabase
// settings can be pinned to values that cannot reach any real project.
//
//   npm run test:contracts           consumer tests + Pages Functions verification (offline)
//   npm run test:contracts:supabase  Supabase verification against the local stack
//   npm run contracts:update         rewrite contracts/*.json after an intended frontend change

const PLACEHOLDER_ENV = {
  VITE_SUPABASE_URL: 'http://supabase.contract.test',
  VITE_SUPABASE_ANON_KEY: 'contract-anon-key',
  VITE_USDA_API_KEY: '',
}

const project = (name: string, include: string[], setupFiles: string[] = []) => ({
  extends: true as const,
  test: { name, include, setupFiles },
})

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    env: PLACEHOLDER_ENV,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    projects: [
      // The frontend's real calls against a recording stand-in: writes contracts/*.json.
      project('consumer', ['contracts/consumer/**/*.test.ts'], ['contracts/support/setup.ts']),
      // The Pages Functions, called in-process with Claude and Supabase Auth scripted.
      project(
        'provider-functions',
        ['contracts/provider/functions.verify.test.ts'],
        ['contracts/support/setup.ts'],
      ),
      // PostgREST + Auth of the local Supabase stack (needs `supabase start`).
      project('provider-supabase', ['contracts/provider/supabase.verify.test.ts']),
    ],
  },
})
