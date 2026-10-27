/**
 * Provider verification for the Cloudflare Pages Functions: every interaction
 * in contracts/fitlog-web--pages-functions.json is replayed against the real
 * handlers in functions/api/, called in-process (no wrangler, no network).
 * What the functions call out to (Supabase Auth to check the session, the
 * Claude API) is scripted from the interaction's provider states.
 *
 * A failure here means the API no longer gives the frontend what it reads:
 * the message names the route, the interaction and the field.
 */

import { describe, expect, test } from 'vitest'
import { readContract } from '../support/contractFile'
import { describeRequest, setFetchHandler, type FetchHandler } from '../support/network'
import { assertMatches } from '../support/schema'
import { errorResponse, messageResponse, streamResponse } from '../support/claude'
import type { Interaction, ProviderState, RecordedRequest } from '../support/types'

const contract = readContract('pages-functions')

const APP_URL = 'https://app.provider.test'
const SUPABASE_URL = 'https://supabase.provider.test'
const CLAUDE_URL = 'https://claude.provider.test'
const ANON_KEY = 'provider-anon-key'
const API_KEY = 'sk-ant-provider-contract-key'
const SESSION_TOKEN = 'provider-session-token'
const USER_ID = 'b2c3d4e5-0000-4000-8000-000000000002'
const PLACEHOLDERS: Record<string, string> = { accessToken: SESSION_TOKEN, anonKey: ANON_KEY }

/** The provider states this verifier knows how to set up. */
const KNOWN_STATES = [
  'a signed-in user',
  'the session has expired',
  'Claude answers',
  'Claude is down',
  'the AI key is not configured',
]

interface Env {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL?: string
  ANTHROPIC_TIMEOUT_MS?: string
}
type Handler = (context: { request: Request; env: Env }) => Promise<Response>
type Middleware = (context: {
  request: Request
  env: Env
  next: () => Promise<Response>
}) => Promise<Response>

// Every function file, loaded on demand. A route the app calls that has no
// file here is a removed endpoint.
const modules = import.meta.glob('../../functions/api/*.ts')

const state = (states: ProviderState[], name: string) => states.find((s) => s.name === name)
const preview = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}...` : s)
const fill = (text: string) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = PLACEHOLDERS[name]
    if (value === undefined) throw new Error(`no provider value for {{${name}}}`)
    return value
  })
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

function envFor(states: ProviderState[]): Env {
  return {
    VITE_SUPABASE_URL: SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: ANON_KEY,
    ANTHROPIC_API_KEY: state(states, 'the AI key is not configured') ? undefined : API_KEY,
    ANTHROPIC_BASE_URL: CLAUDE_URL,
    ANTHROPIC_TIMEOUT_MS: '2000',
  }
}

/** What the function's own outgoing calls get, per the interaction's states. */
function upstream(interaction: Interaction): FetchHandler {
  const states = interaction.providerStates
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))

    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      const ok =
        !state(states, 'the session has expired') &&
        headers.get('authorization') === `Bearer ${SESSION_TOKEN}` &&
        headers.get('apikey') === ANON_KEY
      return ok
        ? json(200, { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'p@contract.test' })
        : json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' })
    }

    if (url === `${CLAUDE_URL}/v1/messages`) {
      if (state(states, 'Claude is down')) return errorResponse(500, 'api_error', 'Internal server error')
      const answers = state(states, 'Claude answers')
      if (!answers)
        throw new Error(
          `the function called Claude, but no provider state of "${interaction.id}" says what Claude answers`,
        )
      const text = String(answers.params?.text ?? '')
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        stream?: boolean
        output_config?: { format?: { type?: string; schema?: Parameters<typeof messageResponse>[1] } }
      }
      if (body.stream) return streamResponse(text)
      // Structured output: the answer takes the shape the function asked for.
      const format = body.output_config?.format
      return messageResponse(text, format?.type === 'json_schema' ? format.schema : undefined)
    }

    throw new Error(`unexpected outgoing call from the function: ${describeRequest(input, init)}`)
  }
}

function toRequest(r: RecordedRequest): Request {
  const url = new URL(`${APP_URL}${r.path}`)
  for (const [k, v] of Object.entries(r.query)) url.searchParams.set(k, fill(v))
  const headers = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, fill(v)]))
  return new Request(url, {
    method: r.method,
    headers,
    body: r.body === null ? undefined : fill(JSON.stringify(r.body)),
  })
}

describe(`${contract.consumer} -> ${contract.provider}`, () => {
  for (const interaction of contract.interactions) {
    const { request: want, response: expected, providerStates: states } = interaction
    const where = `${want.method} ${want.path} [${interaction.id}]`

    test(`${interaction.id}: ${interaction.description}`, async () => {
      for (const s of states)
        if (!KNOWN_STATES.includes(s.name))
          throw new Error(`unknown provider state "${s.name}" in ${interaction.id}; teach this verifier how to set it up`)

      // The handler for this route, from its file.
      const name = want.path.replace(/^\/api\//, '')
      const file = `functions/api/${name}.ts`
      const load = modules[`../../${file}`]
      if (!load)
        throw new Error(
          `No Pages Function answers ${want.method} ${want.path}: ${file} does not exist, but the app calls it from ${interaction.consumer}`,
        )
      const mod = (await load()) as Record<string, unknown>
      const exportName = `onRequest${want.method[0]}${want.method.slice(1).toLowerCase()}`
      const handler = (mod[exportName] ?? mod.onRequest) as Handler | undefined
      if (!handler)
        throw new Error(`${file} exports neither ${exportName} nor onRequest, so ${want.method} ${want.path} has no handler`)
      const loadMiddleware = modules['../../functions/api/_middleware.ts']
      if (!loadMiddleware)
        throw new Error('functions/api/_middleware.ts is missing: every /api route must sit behind the sign-in gate')
      const { onRequest } = (await loadMiddleware()) as { onRequest: Middleware }

      // Replay the recorded request through the gate and the handler.
      setFetchHandler(upstream(interaction))
      const request = toRequest(want)
      const env = envFor(states)
      const res = await onRequest({ request, env, next: () => handler({ request, env }) })
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

      if (expected.schema) {
        const contentType = expected.headers['content-type'] ?? res.headers.get('content-type') ?? ''
        let value: unknown = text
        if (!contentType.startsWith('text/')) {
          try {
            value = JSON.parse(text)
          } catch {
            throw new Error(`${where}: the ${expected.status} body is not JSON: ${preview(text)}`)
          }
        }
        assertMatches(expected.schema, value, `${where}: the ${expected.status} body`)
      }

      // A streamed answer must reach the app exactly as Claude gave it.
      const answers = state(states, 'Claude answers')
      if (answers && expected.status === 200 && typeof expected.example === 'string')
        expect(text, `${where}: the streamed answer`).toBe(String(answers.params?.text))
    })
  }
})
