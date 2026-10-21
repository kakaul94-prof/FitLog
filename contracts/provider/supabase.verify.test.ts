/**
 * Provider verification for Supabase: contracts/fitlog-web--supabase.json
 * against the LOCAL stack (`supabase start`, the same one the API and E2E
 * suites use), never a hosted project.
 *
 * Two checks per interaction:
 *  1. Schema: PostgREST publishes an OpenAPI description of the live database
 *     at /rest/v1/. Every column the app reads or writes must still exist,
 *     with a compatible type and nullability. A rename or a type change is
 *     reported by table and column.
 *  2. Replay: the recorded request is sent for real (as a user created for
 *     this run) and the response must have the status and shape the app reads.
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY (source api-tests/scripts/local-env.sh);
 * SUPABASE_SERVICE_ROLE_KEY, when set, is used only to delete the run's user.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readContract } from '../support/contractFile'
import { assertMatches } from '../support/schema'
import type { Interaction, JsonSchema, ProviderState, RecordedRequest } from '../support/types'

const contract = readContract('supabase')

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !ANON_KEY)
  throw new Error(
    'SUPABASE_URL and SUPABASE_ANON_KEY are not set. Start the local stack (npm run db:start) and export them: source api-tests/scripts/local-env.sh',
  )
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']
if (!LOCAL_HOSTS.includes(new URL(SUPABASE_URL).hostname))
  throw new Error(`refusing to verify against ${SUPABASE_URL}: contract tests only ever run against the local stack`)

// -- this run's user and ids ---------------------------------------------------------

const RUN = randomUUID().slice(0, 8)
const account = { email: `contract-${RUN}@contract.test`, password: `Contract-pw-${RUN}` }
/** {{placeholder}} -> this run's value. accessToken and userId arrive at sign-up. */
const values: Record<string, string> = { anonKey: ANON_KEY, email: account.email, password: account.password }
/** The contract's example ids -> fresh ids, so runs never collide on primary keys. */
const ids = new Map<string, string>()
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const mapId = (example: string) => {
  let fresh = ids.get(example)
  if (!fresh) {
    fresh = randomUUID()
    ids.set(example, fresh)
  }
  return fresh
}
/** Example ids and placeholders replaced by this run's values, in any JSON text. */
function materialize(text: string): string {
  return text
    .replace(UUID, mapId)
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const value = values[name]
      if (value === undefined) throw new Error(`no value for {{${name}}} in this run`)
      return value
    })
}

const preview = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}...` : s)

async function api(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${options.token ?? ANON_KEY}`,
      'content-type': 'application/json',
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

interface OpenApiColumn {
  type?: string
  format?: string
}
interface OpenApi {
  definitions?: Record<string, { properties?: Record<string, OpenApiColumn>; required?: string[] }>
}
let openapi: OpenApi

beforeAll(async () => {
  const signup = await api('POST', '/auth/v1/signup', { body: account })
  const session = (await signup.json()) as { access_token?: string; user?: { id: string }; msg?: string }
  if (!signup.ok || !session.access_token || !session.user)
    throw new Error(
      `could not create this run's user on the local stack (${signup.status}): ${JSON.stringify(session).slice(0, 300)}`,
    )
  values.accessToken = session.access_token
  values.userId = session.user.id

  const spec = await api('GET', '/rest/v1/')
  if (!spec.ok) throw new Error(`PostgREST did not return its OpenAPI description: ${spec.status}`)
  openapi = (await spec.json()) as OpenApi
})

afterAll(async () => {
  if (!SERVICE_KEY || !values.userId) return
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${values.userId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
})

// -- provider states --------------------------------------------------------------------

async function rowExists(table: string, filter: string): Promise<boolean> {
  const res = await api('GET', `/rest/v1/${table}?select=id&${filter}`, { token: values.accessToken })
  if (!res.ok) throw new Error(`could not read ${table} while setting up a provider state: ${res.status}`)
  return ((await res.json()) as unknown[]).length > 0
}

async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const res = await api('POST', `/rest/v1/${table}`, { token: values.accessToken, body: row })
  if (!res.ok)
    throw new Error(`could not insert into ${table} while setting up a provider state: ${res.status} ${await res.text()}`)
}

async function applyState(s: ProviderState, interaction: Interaction): Promise<void> {
  const param = (name: string) => {
    const v = s.params?.[name]
    if (v === undefined) throw new Error(`provider state "${s.name}" of ${interaction.id} needs a "${name}" param`)
    return String(v)
  }
  switch (s.name) {
    case 'a signed-in user': // created in beforeAll
    case 'the password is wrong': // nothing to set up: the recorded body carries a wrong one
    case 'the user has a profile': // the sign-up trigger creates it
      return
    case 'a food exists': {
      const id = mapId(param('id'))
      if (!(await rowExists('foods', `id=eq.${id}`)))
        await insertRow('foods', {
          id,
          name: 'Greek yogurt (contract test)',
          serving_qty: 170,
          serving_unit: 'g',
          nutrients: { kcal: 150, protein: 15, carb: 8, fat: 7 },
        })
      return
    }
    case 'a diary entry exists': {
      const id = mapId(param('id'))
      if (!(await rowExists('diary_entries', `id=eq.${id}`)))
        await insertRow('diary_entries', {
          id,
          entry_date: param('date'),
          meal: 'lunch',
          food_name: 'Greek yogurt (contract test)',
          servings: 1,
          nutrients: { kcal: 150, protein: 15 },
        })
      return
    }
    case 'no diary entry': {
      const res = await api('DELETE', `/rest/v1/diary_entries?id=eq.${mapId(param('id'))}`, {
        token: values.accessToken,
      })
      if (!res.ok) throw new Error(`could not clear a diary entry for a provider state: ${res.status}`)
      return
    }
    case 'an exercise entry exists': {
      const date = param('date')
      if (!(await rowExists('exercise_entries', `entry_date=eq.${date}`)))
        await insertRow('exercise_entries', {
          entry_date: date,
          name: 'Walking',
          met: 3.5,
          duration_min: 30,
          calories: 120,
        })
      return
    }
    default:
      throw new Error(
        `unknown provider state "${s.name}" in ${interaction.id}; teach contracts/provider/supabase.verify.test.ts how to set it up`,
      )
  }
}

// -- 1. the schema still has what the app reads and writes ---------------------------

const tableOf = (i: Interaction) => /^\/rest\/v1\/([a-z_]+)$/.exec(i.request.path)?.[1] ?? null

/** The schema of one row (a list or a single object) of a successful read.
 *  Error bodies describe the error, not a row, so they are not compared. */
function rowSchema(i: Interaction): JsonSchema | null {
  const schema = i.response.schema
  if (!schema || i.response.status >= 300) return null
  if (schema.type === 'array') return schema.items ?? null
  return schema.type === 'object' ? schema : null
}

function columnKind(c: OpenApiColumn): string {
  if (c.format && /json/.test(c.format)) return 'json'
  return c.type ?? 'unknown' // 'array' for integer[] and the like
}

function compatible(wanted: string, actual: string): boolean {
  switch (wanted) {
    case 'string':
      return actual === 'string'
    case 'number':
      return actual === 'number' || actual === 'integer'
    case 'integer':
      return actual === 'integer'
    case 'boolean':
      return actual === 'boolean'
    case 'object':
      return actual === 'json'
    case 'array':
      return actual === 'json' || actual === 'array'
    default:
      return true
  }
}

const schemaOf = (value: unknown): JsonSchema | null =>
  value === null || value === undefined
    ? null
    : Array.isArray(value) || typeof value === 'object'
      ? { type: 'object' }
      : { type: typeof value }

function columnProblems(
  table: string,
  column: string,
  schema: JsonSchema | null,
  def: NonNullable<OpenApi['definitions']>[string],
  verb: 'reads' | 'writes',
): string[] {
  const col = def.properties?.[column]
  if (!col) return [`${table}.${column}: the app ${verb} this column, but the API no longer has it`]
  if (!schema) return []
  const problems: string[] = []
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const wanted = types.filter((x) => x !== 'null')
  const actual = columnKind(col)
  if (wanted.length && !wanted.some((w) => compatible(w, actual)))
    problems.push(
      `${table}.${column}: the app ${verb} it as ${wanted.join('|')}, but the column is now ${col.format ?? col.type} (${actual})`,
    )
  if (verb === 'reads' && !types.includes('null') && !(def.required ?? []).includes(column))
    problems.push(`${table}.${column}: the app treats it as never null, but the column is nullable`)
  return problems
}

function schemaProblems(i: Interaction): string[] {
  const table = tableOf(i)
  if (!table) return []
  const def = openapi.definitions?.[table]
  if (!def)
    return [`table "${table}" is no longer exposed by the API (the app calls ${i.request.method} /rest/v1/${table} from ${i.consumer})`]
  const problems: string[] = []
  const reads = rowSchema(i)
  for (const [column, schema] of Object.entries(reads?.properties ?? {}))
    problems.push(...columnProblems(table, column, schema, def, 'reads'))
  const body = i.request.body
  const rows = (Array.isArray(body) ? body : body ? [body] : []) as Record<string, unknown>[]
  for (const column of new Set(rows.flatMap((r) => Object.keys(r)))) {
    const sample = rows.map((r) => r[column]).find((v) => v !== null && v !== undefined)
    problems.push(...columnProblems(table, column, schemaOf(sample), def, 'writes'))
  }
  return problems
}

describe('the database still has what the app reads and writes (PostgREST OpenAPI)', () => {
  for (const interaction of contract.interactions.filter(tableOf)) {
    test(`${interaction.id}: ${interaction.request.method} ${interaction.request.path}`, () => {
      expect(schemaProblems(interaction), `schema drift behind ${interaction.id}`).toEqual([])
    })
  }
})

// -- 2. the live replay ---------------------------------------------------------------------

describe('live replay against the local stack', () => {
  for (const interaction of contract.interactions) {
    const { request: want, response: expected } = interaction
    const where = `${want.method} ${want.path} [${interaction.id}]`

    test(`${interaction.id}: ${interaction.description}`, async () => {
      for (const s of interaction.providerStates) await applyState(s, interaction)

      const req = JSON.parse(materialize(JSON.stringify(want))) as RecordedRequest
      const url = new URL(`${SUPABASE_URL}${req.path}`)
      for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v)
      const res = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body === null ? undefined : JSON.stringify(req.body),
      })
      const text = await res.text()

      expect(
        res.status,
        `${where} answered ${res.status} ${preview(text)}; the app expects ${expected.status}`,
      ).toBe(expected.status)

      for (const [header, value] of Object.entries(expected.headers)) {
        const actual = res.headers.get(header) ?? ''
        expect(
          actual.startsWith(value),
          `${where}: header ${header} is "${actual}", the app expects it to start with "${value}"`,
        ).toBe(true)
      }

      if (!expected.schema) return
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new Error(`${where}: the ${expected.status} body is not JSON: ${preview(text)}`)
      }
      assertMatches(expected.schema, value, `${where}: the ${expected.status} body`)

      // A read whose state promises a row must actually return one, or the
      // row schema above was never exercised.
      const promised = interaction.providerStates.find((s) =>
        ['a diary entry exists', 'an exercise entry exists', 'the user has a profile'].includes(s.name),
      )
      if (promised && Array.isArray(value))
        expect(value.length, `${where}: the provider state "${promised.name}" promised a row`).toBeGreaterThan(0)
    })
  }
})
