// Scripted answers from "Claude" for the Pages Functions provider verification.
// Same wire format as the Python stub the API tests use
// (testkit/src/testkit/anthropic_stub.py), so both suites exercise the
// functions' real parsing code; no request ever leaves the process.

const MODEL = 'claude-haiku-4-5'

function message(text: string) {
  return {
    id: 'msg_contract',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

interface Shape {
  type?: string
  properties?: Record<string, Shape>
  required?: string[]
  items?: Shape
}

/**
 * What a structured-output answer looks like once the model has obeyed the
 * JSON schema the function asked for: the known values (from the provider
 * state) keyed and typed the way the REQUESTED schema says. So a function that
 * renames or retypes a field in the schema it sends to Claude gets an answer
 * in that new shape, exactly as it would in production, and the contract
 * check sees the drift.
 */
function shapedTo(schema: Shape, known: unknown): unknown {
  switch (schema.type) {
    case 'object': {
      const source = (known && typeof known === 'object' ? known : {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (source[key] !== undefined) out[key] = shapedTo(sub, source[key])
        else if (schema.required?.includes(key)) out[key] = shapedTo(sub, undefined)
      }
      return out
    }
    case 'array':
      return (Array.isArray(known) ? known : [undefined]).map((item) => shapedTo(schema.items ?? {}, item))
    case 'string':
      return typeof known === 'string' ? known : known === undefined ? 'text' : String(known)
    case 'number':
    case 'integer':
      return typeof known === 'number' ? known : Number(known) || 1
    case 'boolean':
      return Boolean(known)
    default:
      return known
  }
}

/** A non-streaming Messages API reply (what scan-plate asks for). With the
 *  json_schema the function requested, the answer is shaped to it (see shapedTo). */
export function messageResponse(text: string, requested?: Shape): Response {
  let answer = text
  if (requested) {
    try {
      answer = JSON.stringify(shapedTo(requested, JSON.parse(text)))
    } catch {
      // Not JSON: the model "answered" in prose, which the function must reject.
    }
  }
  return new Response(JSON.stringify(message(answer)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A streaming Messages API reply (what the trainer asks for), one SSE frame per word. */
export function streamResponse(text: string): Response {
  const words = text.split(' ')
  const deltas = words.map((w, i) => (i === words.length - 1 ? w : `${w} `))
  const events: Array<[string, unknown]> = [
    ['message_start', { type: 'message_start', message: { ...message(''), content: [] } }],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    ...deltas.map(
      (d): [string, unknown] => [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: d } },
      ],
    ),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        usage: { output_tokens: deltas.length },
        delta: { stop_reason: 'end_turn', stop_sequence: null },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]
  const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** An API error, in Anthropic's error envelope. */
export function errorResponse(status: number, type: string, text: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: text } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
