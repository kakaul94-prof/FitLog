// A small PostgREST request builder in the shape of supabase-js, so a journey
// reads like the app's own hook and sends the same request:
//
//   rest(session).from('foods').select('*').eq('archived', 'false')
//     .ilike('name', '*chic*').order('updated_at', { ascending: false }).limit(50)
//     .get('foods.search')
//
// Every request is tagged with its endpoint name and group (config/endpoints.ts),
// `scope:journey` (so setup traffic stays out of the budgets) and the phase of
// the run. `prepare(...)` returns the request for http.batch, which is how the
// app's pages fire their queries: several at once.
import http, { type ObjectBatchRequest, type Params, type RefinedResponse, type ResponseType } from 'k6/http'
import { ENDPOINTS, type EndpointName } from '../config/endpoints.ts'
import { currentPhase } from './phase.ts'

export type Response = RefinedResponse<ResponseType | undefined>
export type Row = Record<string, unknown>

/** Whoever is making the request: the public anon key plus their own token. */
export interface Caller {
  baseUrl: string
  apikey: string
  bearer: string
}

export type Scope = 'journey' | 'setup'

export function tagsFor(name: EndpointName, scope: Scope = 'journey'): Record<string, string> {
  const op = ENDPOINTS[name]
  if (!op) throw new Error(`Unknown endpoint '${String(name)}': add it to perf-tests/config/endpoints.ts`)
  // Setup traffic (seeding, the pre-flight sign-in and trainer warm-up) keeps
  // its own name and group, so no budget, which all key on `op` or `name`,
  // ever counts it.
  if (scope !== 'journey') return { name: `setup.${name}`, op: 'setup', scope, phase: 'setup' }
  return { name, op, scope, phase: currentPhase() }
}

export function headersFor(caller: Caller, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: caller.apikey,
    Authorization: `Bearer ${caller.bearer}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

export type Returning = 'minimal' | 'representation'

export class Query {
  private readonly params: string[] = []
  private readonly orders: string[] = []
  private readonly headers: Record<string, string> = {}

  constructor(
    private readonly caller: Caller,
    private readonly table: string,
    private readonly scope: Scope,
  ) {}

  select(columns = '*'): this {
    this.params.push(`select=${encodeURIComponent(columns)}`)
    return this
  }

  private filter(column: string, op: string, value: string | number | boolean): this {
    this.params.push(`${column}=${op}.${encodeURIComponent(String(value))}`)
    return this
  }

  eq(column: string, value: string | number | boolean): this {
    return this.filter(column, 'eq', value)
  }

  gte(column: string, value: string | number): this {
    return this.filter(column, 'gte', value)
  }

  lte(column: string, value: string | number): this {
    return this.filter(column, 'lte', value)
  }

  /** `pattern` with `*` wildcards, as supabase-js sends `%` ones. */
  ilike(column: string, pattern: string): this {
    return this.filter(column, 'ilike', pattern.replace(/%/g, '*'))
  }

  not(column: string, op: string, value: string | number | boolean | null): this {
    this.params.push(`${column}=not.${op}.${encodeURIComponent(String(value))}`)
    return this
  }

  in(column: string, values: (string | number)[]): this {
    this.params.push(`${column}=in.(${values.map((v) => encodeURIComponent(String(v))).join(',')})`)
    return this
  }

  order(column: string, { ascending = true }: { ascending?: boolean } = {}): this {
    this.orders.push(`${column}.${ascending ? 'asc' : 'desc'}`)
    return this
  }

  limit(n: number): this {
    this.params.push(`limit=${n}`)
    return this
  }

  /** Ask for one object, not an array (PostgREST answers 406 for 0 or 2+ rows). */
  single(): this {
    this.headers.Accept = 'application/vnd.pgrst.object+json'
    return this
  }

  get url(): string {
    const parts = [...this.params]
    if (this.orders.length) parts.push(`order=${this.orders.join(',')}`)
    return `${this.caller.baseUrl}/rest/v1/${this.table}${parts.length ? `?${parts.join('&')}` : ''}`
  }

  /** The request, not yet sent: pass several to `batch()`. */
  prepare(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', name: EndpointName, body?: unknown, extraHeaders: Record<string, string> = {}): ObjectBatchRequest {
    const params: Params = {
      headers: headersFor(this.caller, { ...this.headers, ...extraHeaders }),
      tags: tagsFor(name, this.scope),
    }
    return { method, url: this.url, body: body === undefined ? null : JSON.stringify(body), params }
  }

  send(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', name: EndpointName, body?: unknown, extraHeaders: Record<string, string> = {}): Response {
    const req = this.prepare(method, name, body, extraHeaders)
    return http.request(req.method, req.url, req.body, req.params)
  }

  get(name: EndpointName): Response {
    return this.send('GET', name)
  }

  /** supabase-js sends `return=minimal` for a bare insert and `representation` when `.select()` follows it. */
  insert(rows: Row | Row[], name: EndpointName, returning: Returning = 'minimal'): Response {
    return this.send('POST', name, rows, { Prefer: `return=${returning}` })
  }

  update(patch: Row, name: EndpointName, returning: Returning = 'minimal'): Response {
    return this.send('PATCH', name, patch, { Prefer: `return=${returning}` })
  }

  delete(name: EndpointName): Response {
    return this.send('DELETE', name, undefined, { Prefer: 'return=minimal' })
  }
}

export function rest(caller: Caller, scope: Scope = 'journey') {
  return { from: (table: string) => new Query(caller, table, scope) }
}

/** Send prepared requests concurrently, the way a page fires its queries. */
export function batch(requests: ObjectBatchRequest[]): Response[] {
  return http.batch(requests) as unknown as Response[]
}
