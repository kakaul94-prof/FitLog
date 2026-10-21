// Small JSON-Schema builders (so the contracts read like the TypeScript
// interfaces they mirror) and validation with readable failure messages.

import Ajv, { type ErrorObject } from 'ajv'
import type { JsonSchema } from './types'

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

type Shape = Record<string, JsonSchema>

export const t = {
  string: (): JsonSchema => ({ type: 'string' }),
  /** A string the UI shows, so it must not be empty. */
  text: (): JsonSchema => ({ type: 'string', minLength: 1 }),
  number: (): JsonSchema => ({ type: 'number' }),
  boolean: (): JsonSchema => ({ type: 'boolean' }),
  uuid: (): JsonSchema => ({ type: 'string', pattern: UUID }),
  date: (): JsonSchema => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  timestamp: (): JsonSchema => ({
    type: 'string',
    pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}',
  }),
  oneOf: (...values: string[]): JsonSchema => ({ type: 'string', enum: values }),
  literal: (value: string | number | boolean): JsonSchema => ({
    type: typeof value as 'string' | 'number' | 'boolean',
    const: value,
  }),
  array: (items: JsonSchema): JsonSchema => ({ type: 'array', items }),
  /**
   * An object with every listed property required (the frontend's interfaces
   * have no optional columns) unless named in `optional`. Extra properties are
   * allowed by default: a consumer-driven contract only pins what it reads.
   */
  object: (properties: Shape, options: { optional?: string[]; closed?: boolean } = {}): JsonSchema => ({
    type: 'object',
    properties,
    required: Object.keys(properties).filter((k) => !options.optional?.includes(k)),
    additionalProperties: !options.closed,
  }),
  /** A partial update: any subset of these properties, nothing else. */
  partial: (properties: Shape): JsonSchema => ({
    type: 'object',
    properties,
    required: [],
    additionalProperties: false,
  }),
  /** A jsonb column the frontend treats as an object it owns. */
  json: (): JsonSchema => ({ type: 'object' }),
  nullable: (s: JsonSchema): JsonSchema => {
    const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type]
    const out: JsonSchema = { ...s, type: [...types, 'null'] }
    if (s.enum) out.enum = [...s.enum, null]
    return out
  },
}

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true })
const compiled = new WeakMap<JsonSchema, ReturnType<typeof ajv.compile>>()

function validator(schema: JsonSchema) {
  let v = compiled.get(schema)
  if (!v) {
    v = ajv.compile(schema)
    compiled.set(schema, v)
  }
  return v
}

function preview(value: unknown): string {
  if (value === undefined) return 'undefined'
  const s = JSON.stringify(value)
  return s.length > 60 ? `${s.slice(0, 57)}...` : s
}

function describe(e: ErrorObject): string {
  const where = e.instancePath
    ? `$${e.instancePath.replace(/\/(\d+)(?=\/|$)/g, '[$1]').replace(/\//g, '.')}`
    : '$'
  switch (e.keyword) {
    case 'required':
      return `${where}: missing required field "${e.params.missingProperty}"`
    case 'type':
      return `${where}: must be ${e.params.type}, got ${preview(e.data)}`
    case 'enum':
      return `${where}: must be one of ${JSON.stringify(e.params.allowedValues)}, got ${preview(e.data)}`
    case 'const':
      return `${where}: must be ${preview(e.params.allowedValue)}, got ${preview(e.data)}`
    case 'additionalProperties':
      return `${where}: unexpected field "${e.params.additionalProperty}"`
    case 'pattern':
      return `${where}: ${preview(e.data)} does not match ${e.params.pattern}`
    default:
      return `${where}: ${e.message ?? e.keyword}, got ${preview(e.data)}`
  }
}

/** Every way `value` breaks `schema`, as one readable line each. Empty = valid. */
export function schemaErrors(schema: JsonSchema, value: unknown): string[] {
  const v = validator(schema)
  if (v(value)) return []
  return (v.errors ?? []).map(describe)
}

/** Throws with every mismatch listed when `value` doesn't satisfy `schema`. */
export function assertMatches(schema: JsonSchema, value: unknown, what: string): void {
  const errors = schemaErrors(schema, value)
  if (errors.length)
    throw new Error(`${what} does not match the contract:\n  - ${errors.join('\n  - ')}`)
}
