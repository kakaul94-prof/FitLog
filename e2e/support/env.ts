// Where the E2E suite points, and a hard guard that it's never a hosted project.
//
// The suite runs against the LOCAL Supabase stack (`npm run db:start`), which is
// seeded from supabase/schema.sql + supabase/seed.sql. The defaults below are
// the Supabase CLI's well-known local-dev values (identical on every machine),
// not secrets. Inside the Playwright container the stack is reached through
// host.docker.internal instead of 127.0.0.1 (see compose.yaml).

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'

export const SUPABASE_ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', 'host.docker.internal'])

// These specs create and change rows freely, so refuse to start against
// anything that isn't a local stack (e.g. a copied dev/prod project URL).
if (!LOCAL_HOSTS.has(new URL(SUPABASE_URL).hostname)) {
  throw new Error(
    `E2E_SUPABASE_URL must point at the local Supabase stack, got ${SUPABASE_URL}`,
  )
}

/** Accounts created by supabase/seed.sql. */
export const USERS = {
  alice: {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    email: 'alice@e2e.test',
    password: 'alice-password',
  },
  bob: {
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    email: 'bob@e2e.test',
    password: 'bob-password',
  },
  // One account per area with per-user state, so specs running in parallel
  // can't change each other's: Carol owns the program spec, Dave the routines
  // spec (templates change what Alice's Exercise tab shows).
  carol: {
    id: 'cccccccc-0000-4000-8000-000000000003',
    email: 'carol@e2e.test',
    password: 'carol-password',
  },
  dave: {
    id: 'dddddddd-0000-4000-8000-000000000004',
    email: 'dave@e2e.test',
    password: 'dave-password',
  },
} as const

export type TestUser = (typeof USERS)[keyof typeof USERS]

/** Saved browser session for a user who signs in during setup (auth.setup.ts). */
export const authFile = (user: 'alice' | 'carol' | 'dave') => `e2e/.auth/${user}.json`
