// The contract file format shared by the consumer tests (which write the files
// in contracts/*.json) and the provider verifications (which read them).
// Everything here is plain JSON: the files are meant to be read in a code
// review, and another tool (the Python API suite, say) could consume them.

/** The subset of JSON Schema (draft-07) the contracts use. Validated with ajv. */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  pattern?: string
  minLength?: number
  minimum?: number
  additionalProperties?: boolean | JsonSchema
  description?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** The request the frontend really sent, recorded by the consumer test. Secrets
 *  and per-run values are replaced by `{{placeholders}}` (see Recorder). */
export interface RecordedRequest {
  method: HttpMethod
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: unknown
}

export interface ResponseContract {
  status: number
  /** Headers the consumer relies on. `content-type` is matched as a prefix. */
  headers: Record<string, string>
  /** The shape the frontend reads. `null` when it reads nothing (204, 201 minimal). */
  schema: JsonSchema | null
  /** What the consumer test was served, so the file shows a concrete example.
   *  A string for text bodies, `null` for empty ones. */
  example: unknown
}

/** A condition the provider must set up before the interaction is replayed
 *  (Pact's "provider state"). Each verifier implements the names it knows and
 *  fails on one it doesn't. */
export interface ProviderState {
  name: string
  params?: Record<string, string | number | boolean>
}

export interface Interaction {
  id: string
  description: string
  /** Where in the frontend this call is made. */
  consumer: string
  providerStates: ProviderState[]
  request: RecordedRequest
  response: ResponseContract
}

export type ProviderName = 'supabase' | 'pages-functions'

export interface Contract {
  format: 'fitlog-contract/1'
  consumer: 'fitlog-web'
  provider: ProviderName
  generatedBy: string
  interactions: Interaction[]
}
