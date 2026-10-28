// promptfoo provider: the FitLog trainer, answered by the app's real code.
//
// Each test runs the deployed Pages Function (functions/api/trainer.ts,
// bundled by lib/bundle.mjs) in-process with the same body the browser posts:
// the question and history, the user's log snapshot (contexts.json, built by
// the app's own trainerContext.ts) and their saved memory. So the system
// prompt, the data blocks, the model id, the 700-token ceiling, the input caps
// and the stream handling are production's, not a copy. The reply is then read
// by the app's own parser (displayText, parseRemember).
//
// The function's one outbound request goes through lib/fetch-shim.mjs to this
// file, which, by mode:
//   live    sends it to the Claude API with the real key swapped in (the
//           function itself only ever holds a placeholder, as in the custom
//           suite's proxy), optionally on another model (config.model) for the
//           model comparison, and meters the tokens the API reports;
//   stub    answers with a scripted stream from stub-replies.yaml (no key, no
//           cost; the CI subset);
//   replay  skips the function and returns vars.reply as is (the calibration
//           replies, which were already answered and labelled).
//
// Live calls are refused unless the runner (run.mjs) set PF_ALLOW_LIVE after
// stating the cost, and are capped at PF_MAX_CALLS, retries included.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { loadTrainer } from './lib/bundle.mjs'
import { loadContexts, renderContext } from './lib/contexts.mjs'

const ANTHROPIC = 'https://api.anthropic.com/v1/messages'
const PLACEHOLDER_KEY = 'placeholder-the-provider-swaps-in-the-real-key'
// USD per million tokens, input and output (list prices; aievals/pricing.py).
// Claude Haiku 5.5's rate is for prompts up to 100K tokens; these are ~3K.
export const PRICES = {
  'claude-haiku-4-5': [1.0, 5.0],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2.0, 10.0],
}
// The function's reason codes (functions/api/trainer.ts; aievals/live.py).
const TRANSIENT = new Set(['rate', 'upstream', 'timeout', 'unreachable'])
const ACCOUNT_FAILURES = new Set(['credits', 'key', 'no-key'])
const MAX_TRIES = 3
const NO_ANSWER = "The trainer didn't send an answer."
const CUT_OFF = '[The trainer was cut off.'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
let stubReplies
let stopped = '' // set once the account can't answer at all: the rest are skipped
let callsMade = 0

export const costOf = (model, input, output) => {
  const [pin, pout] = PRICES[model]
  return (input * pin + output * pout) / 1_000_000
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Reads model, usage and stop reason out of an Anthropic SSE stream as it passes. */
function meter(record) {
  const decoder = new TextDecoder()
  let buffer = ''
  const read = (payload) => {
    let data
    try {
      data = JSON.parse(payload)
    } catch {
      return
    }
    if (data.type === 'message_start') {
      const u = data.message?.usage ?? {}
      record.servedModel = data.message?.model ?? ''
      record.input =
        (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    } else if (data.type === 'message_delta') {
      record.output = data.usage?.output_tokens ?? record.output
      record.stopReason = data.delta?.stop_reason ?? record.stopReason
    }
  }
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events)
        for (const line of event.split('\n')) if (line.startsWith('data:')) read(line.slice(5).trim())
      controller.enqueue(chunk)
    },
  })
}

/** A scripted Anthropic SSE stream carrying `text`, as the real API would send it. */
function scriptedStream(text, model) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const pieces = text.match(/[\s\S]{1,40}/g) ?? []
  const body = [
    event('message_start', {
      message: { id: 'msg_stub', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 0, output_tokens: 0 } },
    }),
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...pieces.map((p) => event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: p } })),
    event('content_block_stop', { index: 0 }),
    event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }),
    event('message_stop', {}),
  ].join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function stubReply(caseId, variant) {
  stubReplies ??= yaml.load(readFileSync(here('./stub-replies.yaml'), 'utf8')).replies
  const reply = stubReplies[caseId]?.[variant]
  if (reply === undefined) throw new Error(`stub-replies.yaml has no ${variant} reply for ${caseId}`)
  return reply
}

export default class TrainerProvider {
  constructor(options = {}) {
    this.config = options.config ?? {}
    this.mode = this.config.mode ?? 'live'
    this.model = this.config.model ?? 'claude-haiku-4-5'
    this.variant = this.config.variant ?? 'good'
    if (this.mode === 'live' && !PRICES[this.model])
      throw new Error(`no list price for ${this.model}: add it to PRICES in provider.mjs`)
    // promptfoo names a custom provider by id() in its results, so the config's
    // label (haiku-4-5, stub-good...) is the id: --filter-providers and the
    // summaries tell the providers apart by it.
    this.label = options.label
  }

  id() {
    if (this.label) return this.label
    return this.mode === 'live' ? `fitlog-trainer:${this.model}` : `fitlog-trainer:${this.mode}`
  }

  async callApi(_prompt, context) {
    const vars = context?.vars ?? {}
    if (this.mode === 'replay' && vars.reply_kind === 'raw') {
      // A raw reply from one of the custom suite's live runs: read by the app's
      // parser, with the rules that run sent (for the prompt-leak check).
      const trainer = await loadTrainer()
      return {
        output: vars.reply,
        metadata: {
          shown: trainer.displayText(vars.reply),
          remember: trainer.parseRemember(vars.reply),
          system: readFileSync(vars.rules_file, 'utf8'),
          context: '',
          memory: [],
          replay: true,
        },
      }
    }
    if (this.mode === 'replay') {
      // A calibration reply, stored as the user saw it (bubble plus chip).
      return { output: vars.reply, metadata: { shown: vars.reply, remember: null, replay: true } }
    }
    if (this.mode === 'live' && process.env.PF_ALLOW_LIVE !== '1')
      return { error: 'live calls cost money: start them with run.mjs, which states the cost first' }

    const trainer = await loadTrainer()
    const entry = loadContexts().entries[vars.context_key]
    const log = renderContext(entry.context, vars.today)
    const memory = entry.memory
    const history = vars.history ? JSON.parse(vars.history) : []
    const body = { messages: [...history, { role: 'user', content: vars.ask }], context: log, memory }

    const usage = { input: 0, output: 0 }
    let lastError = ''
    for (let tries = 1; tries <= MAX_TRIES; tries++) {
      if (stopped) return { error: `skipped: the account can't answer (${stopped})` }
      if (this.mode === 'live' && ++callsMade > Number(process.env.PF_MAX_CALLS ?? 0))
        return { error: "skipped: the run's call budget is spent" }

      const record = { input: 0, output: 0, servedModel: '', stopReason: '', system: '' }
      const route = trainer.registerCall(async (_url, init) => {
        const sent = JSON.parse(init.body)
        record.system = sent.system
        if (this.mode === 'stub') return scriptedStream(stubReply(vars.case_id, this.variant), sent.model)
        const upstream = await globalThis.fetch(ANTHROPIC, {
          method: 'POST',
          headers: { ...init.headers, 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '' },
          // Only the model changes, and only when the comparison asks for another.
          body: JSON.stringify({ ...sent, model: this.model }),
          signal: init.signal,
        })
        if (!upstream.ok || !upstream.body) return upstream
        return new Response(upstream.body.pipeThrough(meter(record)), {
          status: upstream.status,
          headers: upstream.headers,
        })
      })

      const started = performance.now()
      let raw = ''
      let firstByteMs = 0
      let status = 0
      try {
        const res = await trainer.onRequestPost({
          request: new Request('http://localhost/api/trainer', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
          env: { ANTHROPIC_API_KEY: PLACEHOLDER_KEY, ANTHROPIC_BASE_URL: route.baseUrl },
        })
        status = res.status
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!firstByteMs) firstByteMs = Math.round(performance.now() - started)
          raw += decoder.decode(value, { stream: true })
        }
        raw += decoder.decode()
      } catch (e) {
        lastError = `no response (${e?.name ?? 'Error'}: ${e?.message ?? e})`
        continue
      } finally {
        route.done()
      }
      const totalMs = Math.round(performance.now() - started)
      usage.input += record.input
      usage.output += record.output

      if (status === 200 && raw && !raw.startsWith(NO_ANSWER)) {
        const cost = this.mode === 'live' ? costOf(this.model, usage.input, usage.output) : 0
        return {
          output: raw,
          tokenUsage: { prompt: usage.input, completion: usage.output, total: usage.input + usage.output, numRequests: tries },
          cost,
          latencyMs: totalMs,
          metadata: {
            model: this.mode === 'live' ? this.model : 'stub',
            served_model: record.servedModel,
            stop_reason: record.stopReason,
            input_tokens: usage.input,
            output_tokens: usage.output,
            first_byte_ms: firstByteMs,
            total_ms: totalMs,
            tries,
            cut_off: raw.includes(CUT_OFF),
            words: (raw.match(/\S+/g) ?? []).length,
            shown: trainer.displayText(raw),
            remember: trainer.parseRemember(raw),
            system: record.system,
            context: log,
            memory,
          },
        }
      }
      lastError = `HTTP ${status}: ${raw.slice(0, 160)}`
      const code = /\(code: ([a-z-]+)\)/.exec(raw)?.[1] ?? ''
      if (ACCOUNT_FAILURES.has(code)) stopped = code
      if (!TRANSIENT.has(code)) break
      if (tries < MAX_TRIES) await sleep(2 ** tries * 1000 + Math.random() * 1000)
    }
    return {
      error: lastError,
      tokenUsage: { prompt: usage.input, completion: usage.output, total: usage.input + usage.output },
      cost: this.mode === 'live' ? costOf(this.model, usage.input, usage.output) : 0,
    }
  }
}
