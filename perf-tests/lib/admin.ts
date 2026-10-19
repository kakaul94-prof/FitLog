// Service-role calls, for setup and teardown ONLY: creating and deleting the
// run's users and bulk-loading their history. No journey ever sends a request
// with this key; the journeys hold a user's own token (lib/auth.ts).
//
// Everything here is tagged scope:setup so it stays out of every budget.
import http, { type ObjectBatchRequest } from 'k6/http'
import type { Env } from './env.ts'
import type { Row } from './rest.ts'

const INSERT_CHUNK = 2000 // rows per request: ~1 MB of JSON, well inside Kong's limits
const CREATE_CHUNK = 10 // concurrent user creations (each is a bcrypt hash in GoTrue)

const setupTags = (name: string) => ({ name, op: 'setup', scope: 'setup', phase: 'setup' })

function adminHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

export interface Credentials {
  email: string
  password: string
}

export interface CreatedUser extends Credentials {
  id: string
}

/** Create confirmed users, a few at a time. */
export function createUsers(env: Env, users: Credentials[]): CreatedUser[] {
  const created: CreatedUser[] = []
  for (let i = 0; i < users.length; i += CREATE_CHUNK) {
    const chunk = users.slice(i, i + CREATE_CHUNK)
    const requests: ObjectBatchRequest[] = chunk.map((u) => ({
      method: 'POST',
      url: `${env.supabaseUrl}/auth/v1/admin/users`,
      body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
      params: { headers: adminHeaders(env), tags: setupTags('admin.createUser') },
    }))
    const responses = http.batch(requests)
    responses.forEach((res, j) => {
      if (res.status !== 200) throw new Error(`could not create ${chunk[j].email}: ${res.status} ${String(res.body).slice(0, 200)}`)
      created.push({ ...chunk[j], id: (res.json() as { id: string }).id })
    })
  }
  return created
}

/** Delete a user; every row they own cascades with them. Returns the status. */
export function deleteUser(env: Env, id: string): number {
  return http.del(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, null, {
    headers: adminHeaders(env),
    tags: setupTags('admin.deleteUser'),
  }).status
}

export interface ListedUser {
  id: string
  email?: string
}

/** One page of users (GoTrue pages from 1). */
export function listUsers(env: Env, page: number, perPage = 1000): ListedUser[] {
  const res = http.get(`${env.supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
    headers: adminHeaders(env),
    tags: setupTags('admin.listUsers'),
  })
  if (res.status !== 200) throw new Error(`could not list users: ${res.status} ${String(res.body).slice(0, 200)}`)
  return (res.json() as unknown as { users: ListedUser[] }).users ?? []
}

/** Bulk insert as the service role (RLS bypassed; every row names its
 *  `user_id`). With `select`, returns that projection of the inserted rows in
 *  input order; without, returns nothing. Rows in one call must share a key set. */
export function adminInsert(env: Env, table: string, rows: Row[], select?: string): Row[] {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const url = `${env.supabaseUrl}/rest/v1/${table}${select ? `?select=${encodeURIComponent(select)}` : ''}`
    const res = http.post(url, JSON.stringify(chunk), {
      headers: adminHeaders(env, { Prefer: `return=${select ? 'representation' : 'minimal'}` }),
      tags: setupTags(`seed.${table}`),
    })
    if (res.status !== 201) throw new Error(`seeding ${table} failed: ${res.status} ${String(res.body).slice(0, 300)}`)
    if (select) out.push(...(res.json() as unknown as Row[]))
  }
  return out
}
