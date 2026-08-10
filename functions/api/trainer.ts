// Cloudflare Pages Function: POST /api/trainer
// The Ask-a-trainer chat behind Exercise → Ask. Answers training questions
// ("my left knee aches when I squat", "how do I add 20 lb to my bench?") with
// Claude Haiku, grounded in a snapshot of the user's OWN logged training that
// the client builds and sends up (src/lib/trainerContext.ts) plus any facts
// they've saved to trainer memory. The API key is a server-side Pages secret —
// the same ANTHROPIC_API_KEY that scan-plate and import-recipe already use, so
// nothing sensitive ships to the browser.
//
// Unlike the other Claude calls in this app this one STREAMS: a chat answer is
// read as it lands, and waiting ~4s for a paragraph feels broken. We transform
// Anthropic's SSE into plain UTF-8 text chunks so the client just appends what
// it reads — no event parsing in the browser.

interface Env {
  ANTHROPIC_API_KEY?: string
}

const MODEL = 'claude-haiku-4-5'

// Roughly a page of text. Chat answers should be short; this is a ceiling, not
// a target (the prompt asks for brevity).
const MAX_TOKENS = 1200

// Input caps. The client already trims, but this endpoint is the trust boundary
// — a runaway history is what turns a $0.003 question into a $0.05 one.
const MAX_TURNS = 12
const MAX_MESSAGE_CHARS = 4000
// Generous: the snapshot carries lift history AND nutrition, and nutrition is
// rendered last — a tight cap would silently truncate exactly the section that
// answers "why have I stalled?".
const MAX_CONTEXT_CHARS = 12000
const MAX_MEMORY_ITEMS = 40
const MAX_MEMORY_CHARS = 300

/** Emitted verbatim at the end of a reply when the trainer learns something
 *  durable. The client strips it from the bubble and offers it as a save chip
 *  (see parseRemember in src/lib/trainer.ts) — keep the two in sync. */
const REMEMBER_TAG = '[[REMEMBER: <one short fact>]]'

const SYSTEM = `You are the training coach inside FitLog, a personal workout and nutrition tracker. You are talking to the single person whose data this app holds. You can see their real logged training AND their food diary below — use both.

How to answer:
- Be direct and specific. Open with the answer, then the reasoning. No preamble, no restating the question.
- Keep it short: a few sentences for a simple question, and at most a couple of short paragraphs or a tight list for a complex one. This is read on a phone.
- Ground advice in their actual numbers whenever the data supports it — name the lift, the weight, the date, the trend. "Your squat has sat at 225 for three sessions" beats "progress can stall".
- If the data needed to answer well isn't there, say so plainly and give the general answer instead. Never invent sessions, weights, or dates that are not in the snapshot.
- Give a concrete next action: a weight, a rep range, a number of sets, a change to make next session.
- Use lb and the exercise names as they appear in their log.
- Plain text only. No markdown headings, no bold, no tables. A short "- " list is fine.

If the snapshot says MID-WORKOUT RIGHT NOW, they are standing in the gym between sets:
- Answer in one or two sentences. Lead with the call — a weight, a rep count, stop or keep going. Save the reasoning unless they ask for it.
- Use the sets they have already logged this session, and what is still on today's list.
- No lists, no caveats, no "it depends". They need a decision in the ten seconds before the next set.

Fuelling — you can see their food diary, so use it:
- Before blaming programming for a stall, a plateau, low energy or poor recovery, check intake. A lifter eating well under maintenance, or short on protein, will stall no matter how good the programming is. Say so directly when the numbers show it.
- Treat measured maintenance (derived from their intake against their actual weight change) as better evidence than the calculated calorie goal when the two disagree.
- Protein is the lever that matters most for lifting. Roughly 0.7–1.0 g per lb of bodyweight supports building; judge their average against that and name the gap in grams.
- Respect a deliberate cut. If they are intentionally losing weight, do not tell them to just eat more — explain the trade-off with strength and help them choose, or protect the lifts within the deficit.
- Never prescribe a specific calorie or macro number as a medical instruction, and never give advice aimed at losing weight as fast as possible.

Micronutrients — be careful:
- The micro percentages are unreliable in a specific way: branded and hand-entered foods often carry no micronutrient data at all, so a low number usually means "not recorded", not "not eaten".
- Never state or imply that they are deficient in anything, and never recommend a supplement dose. You cannot diagnose a deficiency from a food log.
- At most, note that a nutrient looks under-recorded, name a few foods rich in it, and say a blood test through their doctor is the only way to know.

Pain and injury — important:
- You are not a doctor and must not diagnose. Never name a specific injury as fact.
- For ordinary training aches: give practical load-management and technique guidance (reduce load, adjust range of motion or stance, swap to a tolerable variation, warm up differently) and say what to watch for.
- Tell them to see a physio or doctor if there are red flags: sharp or sudden pain, swelling, a joint giving way or locking, numbness or tingling, pain at rest or at night, or anything still there after about two weeks.
- Never tell them to push through pain.

Remembering things:
- If the conversation reveals a durable fact worth carrying into future chats — a recurring niggle, an equipment limitation, a preference, a schedule constraint, a response to a training style — end your reply with a line in exactly this form: ${REMEMBER_TAG}
- One short factual sentence, written about them ("Left knee aches on deep squats above 225"). Nothing about today's weights or a one-off.
- Only when it is genuinely new and lasting. Most replies should NOT include this line. Never repeat a fact already in memory.`

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Keep only well-formed turns, cap length, and make sure the history starts on
 *  a user turn and alternates — the API rejects anything else. */
function cleanMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return []
  const out: ChatMessage[] = []
  for (const raw of input) {
    const m = raw as { role?: unknown; content?: unknown }
    const role = m?.role === 'assistant' ? 'assistant' : 'user'
    const content = typeof m?.content === 'string' ? m.content.trim() : ''
    if (!content) continue
    // Collapse a repeated role into the previous turn rather than dropping it.
    const prev = out[out.length - 1]
    if (prev && prev.role === role) prev.content += `\n\n${content}`
    else out.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out.slice(-MAX_TURNS)
}

function cleanMemory(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .slice(0, MAX_MEMORY_ITEMS)
    .map((x) => x.trim().slice(0, MAX_MEMORY_CHARS))
}

function buildSystem(context: string, memory: string[]): string {
  const parts = [SYSTEM]
  if (memory.length)
    parts.push(
      `What you already know about them (saved from past conversations):\n${memory
        .map((m) => `- ${m}`)
        .join('\n')}`,
    )
  parts.push(
    context
      ? `Their training data as of today:\n${context}`
      : 'Their training data is unavailable right now — answer generally and say you could not read their log.',
  )
  return parts.join('\n\n')
}

/** Anthropic SSE -> plain text. Emits only assistant text, so the client can
 *  append chunks straight into the bubble. */
function sseToText(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let refused = false

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      // SSE events are separated by a blank line; keep the trailing partial.
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let data: {
            type?: string
            delta?: { type?: string; text?: string; stop_reason?: string }
            error?: { message?: string }
          }
          try {
            data = JSON.parse(payload)
          } catch {
            continue // a malformed frame shouldn't kill the answer
          }
          if (
            data.type === 'content_block_delta' &&
            data.delta?.type === 'text_delta' &&
            data.delta.text
          ) {
            controller.enqueue(encoder.encode(data.delta.text))
          } else if (
            data.type === 'message_delta' &&
            data.delta?.stop_reason === 'refusal'
          ) {
            refused = true
          } else if (data.type === 'error') {
            controller.enqueue(
              encoder.encode(
                '\n\n[The trainer was cut off. Try asking again.]',
              ),
            )
          }
        }
      }
    },
    flush(controller) {
      // A refusal arrives as a successful response with no usable content, so
      // say something rather than leaving an empty bubble.
      if (refused)
        controller.enqueue(
          encoder.encode(
            "I can't help with that one. Try rephrasing, or ask me something about your training.",
          ),
        )
    },
  })
}

/**
 * Turn an upstream failure into a message that says what to DO about it. This
 * is a single-user app, so a diagnostic beats a polite one — a bare "the
 * trainer is unavailable" sent us hunting through app code once when the real
 * problem was a stale API key in the Cloudflare dashboard.
 */
function upstreamMessage(status: number, body: string): string {
  if (status === 401 || /authentication_error/.test(body))
    return "The trainer can't sign in to Claude. The ANTHROPIC_API_KEY secret on this Cloudflare Pages project is missing, invalid or expired — check Settings → Variables and secrets."
  if (/credit balance/i.test(body))
    return 'The Claude account is out of credits — top it up at console.anthropic.com.'
  if (status === 429)
    return 'Too many requests just now. Wait a few seconds and ask again.'
  if (status >= 500) return 'Claude is having a moment. Try again shortly.'
  return 'The trainer is unavailable right now.'
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  // Trim: a trailing newline or space survives a copy-paste into the Cloudflare
  // secrets field and makes an otherwise-valid key fail as authentication_error,
  // which is indistinguishable from a revoked key until you look at the bytes.
  const raw = env.ANTHROPIC_API_KEY ?? ''
  const key = raw.trim()
  if (!key)
    return json({ error: 'The trainer is not configured (no API key).' }, 503)

  let body: { messages?: unknown; context?: unknown; memory?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const messages = cleanMessages(body.messages)
  if (!messages.length) return json({ error: 'Ask a question first.' }, 400)

  const snapshot =
    typeof body.context === 'string'
      ? body.context.slice(0, MAX_CONTEXT_CHARS)
      : ''

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: buildSystem(snapshot, cleanMemory(body.memory)),
        messages,
      }),
    })
  } catch (e) {
    return json(
      {
        error: 'The trainer is unavailable right now.',
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    return json(
      {
        error: upstreamMessage(res.status, detail),
        detail: detail.slice(0, 400),
        // On an auth failure only, describe the stored secret WITHOUT revealing
        // it: the prefix is identical across all Anthropic keys, and a length
        // plus a whitespace flag is what actually tells you whether the value is
        // malformed, truncated, or something else pasted by mistake.
        ...(res.status === 401 || /authentication_error/.test(detail)
          ? {
              keyShape: `starts "${key.slice(0, 8)}", ${key.length} chars${
                raw !== key ? ', HAD surrounding whitespace (now trimmed)' : ''
              }`,
            }
          : {}),
      },
      502,
    )
  }

  return new Response(res.body.pipeThrough(sseToText()), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      // Chunks are useless if an intermediary buffers the whole body.
      'x-content-type-options': 'nosniff',
    },
  })
}
