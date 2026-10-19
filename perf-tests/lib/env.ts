// Where the suite points, read only from the environment, and the guard that it
// is only ever the LOCAL Supabase stack.
//
// The scenarios create users and write rows freely, so three independent checks
// refuse anything else: the URL's host must be local, the URL must not name a
// hosted Supabase or Cloudflare Pages domain, and both keys must be the CLI's
// local keys (issued by "supabase-demo", with no project `ref` claim; a hosted
// project's keys always carry one). A real production key never gets here, but
// if one did, the guard still refuses before a single request is sent.
//
// perf-tests/run.sh exports these from the running stack (`supabase status`),
// so no key is ever written into a test file.
import encoding from 'k6/encoding'

export interface Env {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string // setup/teardown only: creating, seeding and deleting users
  functionsUrl: string | null // the Pages Functions server, when it is running
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', 'host.docker.internal']
// Hosted domains, refused outright even if someone aliases them locally.
const HOSTED = /supabase\.(co|in|red|com)|pages\.dev|workers\.dev/i

function hostOf(url: string): string {
  const m = /^https?:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url)
  if (!m) throw new Error(`'${url}' is not an http(s) URL`)
  return m[1].replace(/^\[|\]$/g, '').toLowerCase()
}

/** Loopback, Docker's host alias, or a dotless Docker service name (the k6
 *  container reaches Kong as `supabase_kong_<project>`). Anything with a dot
 *  that isn't a known local name is treated as remote. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.includes(host) || !host.includes('.')
}

export function assertLocalUrl(name: string, url: string): void {
  const host = hostOf(url)
  if (HOSTED.test(url) || !isLocalHost(host)) {
    throw new Error(
      `${name} must point at the local test stack, got host '${host}'. ` +
        'This suite creates users and writes rows freely; it never runs against a hosted project.',
    )
  }
}

export function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('not a JWT')
  return JSON.parse(encoding.b64decode(parts[1], 'rawurl', 's')) as Record<string, unknown>
}

export function assertLocalKey(name: string, key: string, role: string): void {
  let payload: Record<string, unknown>
  try {
    payload = jwtPayload(key)
  } catch {
    // Hosted projects also issue non-JWT keys (sb_publishable_…); the local CLI never does.
    throw new Error(`${name} is not the local stack's JWT key; refusing to run`)
  }
  if (payload.ref !== undefined || payload.iss !== 'supabase-demo') {
    throw new Error(`${name} belongs to a hosted Supabase project (iss=${String(payload.iss)}); refusing to run`)
  }
  if (payload.role !== role) throw new Error(`${name} has role '${String(payload.role)}', expected '${role}'`)
}

function required(name: string): string {
  const value = __ENV[name]
  if (!value) {
    throw new Error(`Missing ${name}. Start the local stack (make stack-up) and run through perf-tests/run.sh, which exports it.`)
  }
  return value
}

export function loadEnv(): Env {
  const env: Env = {
    supabaseUrl: required('SUPABASE_URL').replace(/\/+$/, ''),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    functionsUrl: (__ENV.FITLOG_FUNCTIONS_URL || '').replace(/\/+$/, '') || null,
  }
  assertLocalUrl('SUPABASE_URL', env.supabaseUrl)
  if (env.functionsUrl) assertLocalUrl('FITLOG_FUNCTIONS_URL', env.functionsUrl)
  assertLocalKey('SUPABASE_ANON_KEY', env.anonKey, 'anon')
  assertLocalKey('SUPABASE_SERVICE_ROLE_KEY', env.serviceRoleKey, 'service_role')
  return env
}
