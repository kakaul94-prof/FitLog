// The consumer side's stand-in for a provider (Pact's "mock provider").
//
// A consumer test queues an Expectation, then runs the REAL frontend code. The
// recorder answers the code's fetch with the expectation's example response,
// checks that the request the app made is the one the contract describes, and
// records the interaction. At the end of the file the recorded interactions are
// written to contracts/fitlog-web--<provider>.json, which the provider
// verifications replay.

import { setFetchHandler, describeRequest } from './network'
import { assertMatches, schemaErrors } from './schema'
import type {
  Contract,
  HttpMethod,
  Interaction,
  JsonSchema,
  ProviderName,
  ProviderState,
  RecordedRequest,
} from './types'

export interface Expectation {
  id: string
  description: string
  /** Where in the frontend the call is made. */
  consumer: string
  providerStates: ProviderState[]
  request: {
    method: HttpMethod
    path: string
    /** The complete query string the app must send. */
    query?: Record<string, string>
    /** Headers the app must send; values may use `{{placeholders}}`. */
    headers?: Record<string, string>
    /** The JSON body must satisfy this; `null` means the request carries no body. */
    body: JsonSchema | null
  }
  response: {
    status: number
    headers?: Record<string, string>
    /** The shape the frontend reads; `null` when it reads nothing. */
    schema: JsonSchema | null
    /** Served to the app: parsed JSON, a string for text bodies, null for none. */
    body: unknown
    /** Serve a text body as these chunks, for a stream the app reads as it lands. */
    chunks?: string[]
  }
  /** A call to another provider this test needs on the way (a sign-in before an
   *  /api call): matched and answered, but not part of this contract. */
  record?: false
}

/** Request headers worth keeping in the contract. Everything else (client
 *  version strings, trace ids) is noise a provider must not depend on. */
const KEPT_HEADERS = ['accept', 'content-type', 'prefer', 'authorization', 'apikey']

interface SeenRequest {
  method: HttpMethod
  url: URL
  headers: Headers
  bodyText: string | null
}

const preview = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}...` : s)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class Recorder {
  private queue: Expectation[] = []
  private failures: string[] = []
  readonly interactions: Interaction[] = []
  private readonly provider: ProviderName
  /** placeholder name -> real value used in this test file. */
  private readonly values: Record<string, string>

  constructor(provider: ProviderName, placeholders: Record<string, string>) {
    for (const [name, value] of Object.entries(placeholders))
      if (!value) throw new Error(`placeholder {{${name}}} has no value`)
    this.provider = provider
    this.values = placeholders
  }

  /** Route the app's fetch calls through this recorder. */
  install(): void {
    setFetchHandler((input, init) => this.handle(input, init))
  }

  /** The next call the app makes must be this one. */
  expect(e: Expectation): void {
    if (e.response.schema && e.response.body !== null) {
      const served = e.response.chunks ? e.response.chunks.join('') : e.response.body
      assertMatches(e.response.schema, served, `the example response of "${e.id}"`)
    }
    this.queue.push(e)
  }

  /** Call after each test: every expected call was made, and matched. */
  verify(): void {
    const problems = [...this.failures]
    if (this.queue.length)
      problems.push(`the app never made these calls: ${this.queue.map((e) => e.id).join(', ')}`)
    this.failures = []
    this.queue = []
    if (problems.length) throw new Error(`Consumer contract problems:\n - ${problems.join('\n - ')}`)
  }

  contract(generatedBy: string): Contract {
    return {
      format: 'fitlog-contract/1',
      consumer: 'fitlog-web',
      provider: this.provider,
      generatedBy,
      interactions: this.interactions,
    }
  }

  private async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const seen = await normalize(input, init)
    const expectation = this.queue.shift()
    if (!expectation) {
      const msg = `unexpected call with nothing left to expect: ${describeRequest(input, init)}`
      this.failures.push(msg)
      throw new Error(msg)
    }
    const problems = match(expectation, seen, (v) => this.fill(v))
    if (problems.length) {
      const msg = `"${expectation.id}": the app's request did not match the contract:\n     - ${problems.join('\n     - ')}`
      this.failures.push(msg)
      throw new Error(msg)
    }
    if (expectation.record !== false) this.record(expectation, seen)
    return serve(expectation.response)
  }

  private record(e: Expectation, seen: SeenRequest): void {
    const headers: Record<string, string> = {}
    for (const name of KEPT_HEADERS) {
      const value = seen.headers.get(name)
      if (value) headers[name] = value
    }
    const request: RecordedRequest = {
      method: seen.method,
      path: seen.url.pathname,
      query: Object.fromEntries(seen.url.searchParams),
      headers,
      body: seen.bodyText ? JSON.parse(seen.bodyText) : null,
    }
    const interaction: Interaction = {
      id: e.id,
      description: e.description,
      consumer: e.consumer,
      providerStates: e.providerStates,
      request,
      response: {
        status: e.response.status,
        headers: e.response.headers ?? {},
        schema: e.response.schema,
        example: e.response.chunks ? e.response.chunks.join('') : e.response.body,
      },
    }
    const templated = JSON.parse(this.template(JSON.stringify(interaction))) as Interaction
    const existing = this.interactions.find((i) => i.id === e.id)
    if (existing) {
      // The same call made twice in a file (getUser before two writes, say) is
      // one interaction, as long as it really is the same.
      if (JSON.stringify(existing) !== JSON.stringify(templated))
        this.failures.push(`"${e.id}" was recorded twice with different content`)
      return
    }
    this.interactions.push(templated)
  }

  /** Real values -> {{placeholders}}, longest first so a value inside another is safe. */
  private template(text: string): string {
    const entries = Object.entries(this.values).sort((a, b) => b[1].length - a[1].length)
    return entries.reduce(
      (acc, [name, value]) => acc.replace(new RegExp(escapeRe(value), 'g'), `{{${name}}}`),
      text,
    )
  }

  /** {{placeholders}} -> real values (for matching an expected header). */
  private fill(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      const value = this.values[name]
      if (value === undefined) throw new Error(`no value for {{${name}}} in this test`)
      return value
    })
  }
}

async function normalize(input: RequestInfo | URL, init?: RequestInit): Promise<SeenRequest> {
  const req = input instanceof Request ? input : null
  const method = (init?.method ?? req?.method ?? 'GET').toUpperCase() as HttpMethod
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // The /api wrappers use relative URLs, as they do in the browser.
  const url = new URL(raw, 'http://app.contract.test')
  const headers = new Headers(init?.headers ?? req?.headers)
  let bodyText: string | null = null
  if (init?.body != null)
    bodyText = typeof init.body === 'string' ? init.body : await new Response(init.body).text()
  else if (req?.body) bodyText = await req.clone().text()
  return { method, url, headers, bodyText: bodyText === '' ? null : bodyText }
}

function match(e: Expectation, seen: SeenRequest, fill: (v: string) => string): string[] {
  const problems: string[] = []
  const want = e.request
  if (seen.method !== want.method) problems.push(`method ${seen.method}, expected ${want.method}`)
  if (seen.url.pathname !== want.path)
    problems.push(`path ${seen.url.pathname}, expected ${want.path}`)

  const query = Object.fromEntries(seen.url.searchParams)
  const wantQuery = want.query ?? {}
  for (const key of new Set([...Object.keys(query), ...Object.keys(wantQuery)])) {
    const expected = wantQuery[key] === undefined ? undefined : fill(wantQuery[key])
    if (query[key] !== expected)
      problems.push(`query ${key}=${query[key] ?? '(absent)'}, expected ${expected ?? '(absent)'}`)
  }

  for (const [name, value] of Object.entries(want.headers ?? {})) {
    const actual = seen.headers.get(name)
    const expected = fill(value)
    if (actual !== expected)
      problems.push(`header ${name}: ${actual ?? '(absent)'}, expected ${preview(expected)}`)
  }

  if (want.body === null) {
    if (seen.bodyText) problems.push(`unexpected request body: ${preview(seen.bodyText)}`)
  } else if (!seen.bodyText) {
    problems.push('missing request body')
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(seen.bodyText)
      for (const err of schemaErrors(want.body, parsed)) problems.push(`body ${err}`)
    } catch {
      problems.push(`request body is not JSON: ${preview(seen.bodyText)}`)
    }
  }
  return problems
}

function serve(r: Expectation['response']): Response {
  const headers = new Headers(r.headers)
  if (r.chunks) {
    const encoder = new TextEncoder()
    const chunks = r.chunks
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
          await new Promise((resolve) => setTimeout(resolve, 0)) // one chunk per read
        }
        controller.close()
      },
    })
    return new Response(stream, { status: r.status, headers })
  }
  if (r.body === null || r.status === 204) return new Response(null, { status: r.status, headers })
  if (typeof r.body === 'string') return new Response(r.body, { status: r.status, headers })
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(r.body), { status: r.status, headers })
}
