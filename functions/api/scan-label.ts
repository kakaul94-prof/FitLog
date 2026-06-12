// Cloudflare Pages Function: POST /api/scan-label
// Reads a Nutrition Facts photo with Workers AI and returns structured,
// per-serving nutrition mapped to our nutrient keys. Uses the `AI` binding —
// there is NO external API key, so nothing sensitive ships to the browser.
//
// Two steps, because the vision model reliably *reads* a label but ignores
// JSON-mode and just describes it: (1) vision model transcribes the panel to
// text; (2) a text model with JSON mode converts that text to our schema.

interface Env {
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>
  }
}

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

// key -> unit. Mirrors src/lib/nutrients.ts; kept inline so the function stays
// self-contained (the `@/` alias / browser modules don't apply to Functions).
const UNITS: Record<string, 'kcal' | 'g' | 'mg' | 'mcg'> = {
  kcal: 'kcal',
  protein: 'g', carb: 'g', fat: 'g', fiber: 'g', sugar: 'g',
  added_sugar: 'g', sat_fat: 'g', trans_fat: 'g',
  cholesterol: 'mg', sodium: 'mg', potassium: 'mg', calcium: 'mg', iron: 'mg',
  magnesium: 'mg', phosphorus: 'mg', zinc: 'mg', copper: 'mg', manganese: 'mg',
  selenium: 'mcg', vit_a: 'mcg', vit_c: 'mg', vit_d: 'mcg', vit_e: 'mg',
  vit_k: 'mcg', b1: 'mg', b2: 'mg', b3: 'mg', b6: 'mg', folate: 'mcg', b12: 'mcg',
}

const KEYS = Object.keys(UNITS)

const unitLine = () => {
  const by = (u: string) => KEYS.filter((k) => UNITS[k] === u).join(', ')
  return `kcal: kcal. grams: ${by('g')}. milligrams: ${by('mg')}. micrograms: ${by('mcg')}.`
}

// Step 1 — let the vision model do what it's good at: read the label as text.
const READ_PROMPT = `Transcribe the Nutrition Facts label in this image as plain text. Output ONLY the text printed on the label — do NOT describe the image, the layout, or the language, and add no commentary. For the serving size, servings per container, calories, and EVERY nutrient, vitamin, and mineral listed, write the name followed by its PER SERVING number and unit, one per line (e.g. "Calories 150", "Total Fat 8 g", "Sodium 200 mg", "Protein 5 g"). Copy all numbers exactly — do not round, convert, or omit. Include the product name and brand if visible.`

// Step 2 — a text model turns that transcription into our JSON shape.
const structPrompt = (labelText: string) =>
  `Convert the following Nutrition Facts text into a single JSON object. Output ONLY the JSON.
Rules:
- Use the PER SERVING amounts.
- Units per field — ${unitLine()}
- "Includes Xg Added Sugars" maps to added_sugar.
- A value may be written as "<percent>% <amount><unit>" (e.g. "Total Fat 12% 8 g"); the percent is the Daily Value — use the <amount> with its <unit> and IGNORE the percent.
- serving_qty = the serving amount as a number; serving_unit = its text (e.g. "cup", "g", "fl oz"); serving_grams = the gram weight in parentheses, or null.
- name = the product name if present, otherwise "".
- If a value is missing or unreadable, OMIT that key entirely. Never guess and never output 0 for a value that is not stated.
JSON keys: name (string), brand (string), serving_qty (number), serving_unit (string), serving_grams (number or null), nutrients (object whose keys come ONLY from this list: ${KEYS.join(', ')}).

Nutrition Facts text:
${labelText}`

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Extract the first {...} object from a response that may include prose/```json.
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('no json')
  return JSON.parse(text.slice(start, end + 1))
}

// A usable result has at least one positive nutrient value. Guards against the
// model returning an empty or all-zero `nutrients` object (which would silently
// fill the form with zeros).
function hasValues(obj: unknown): boolean {
  const n = (obj as { nutrients?: Record<string, unknown> } | null)?.nutrients
  return (
    !!n &&
    typeof n === 'object' &&
    Object.values(n).some(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
    )
  )
}

// Pull the assistant text out of a model response. Workers AI native models
// return { response }, while OpenAI-compatible partner models return
// { choices: [{ message: { content, reasoning } }] }.
function extractText(res: unknown): string {
  const r = res as {
    response?: unknown
    choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>
  }
  if (typeof r?.response === 'string') return r.response
  const msg = r?.choices?.[0]?.message
  if (typeof msg?.content === 'string' && msg.content.trim()) return msg.content
  if (typeof msg?.reasoning === 'string' && msg.reasoning.trim())
    return msg.reasoning
  if (r?.response != null) return JSON.stringify(r.response)
  return JSON.stringify(res)
}

// Run a model, accepting Meta's license on first use (Workers AI error 5016),
// then retrying. The binding is authenticated, so no token is needed.
async function runWithAgree(
  ai: NonNullable<Env['AI']>,
  model: string,
  input: Record<string, unknown>,
): Promise<string> {
  let res: unknown
  try {
    res = await ai.run(model, input)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/5016|agree|terms|license/i.test(msg)) throw e
    await ai.run(model, { prompt: 'agree' })
    res = await ai.run(model, input)
  }
  return extractText(res)
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  const ai = env.AI
  if (!ai)
    return json({ error: 'Label scanning is not configured (no AI binding).' }, 503)

  let body: { image?: string }
  try {
    body = (await request.json()) as { image?: string }
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (!body.image) return json({ error: 'No image provided.' }, 400)

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(body.image)
  } catch {
    return json({ error: 'Could not read the image.' }, 400)
  }

  // Step 1: vision model transcribes the label.
  let labelText: string
  try {
    labelText = await runWithAgree(ai, VISION_MODEL, {
      image: Array.from(bytes),
      prompt: READ_PROMPT,
      max_tokens: 1024,
      temperature: 0.1,
    })
  } catch (e) {
    return json(
      {
        error: 'The label reader is unavailable right now.',
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }
  if (!labelText.trim())
    return json(
      { error: "Couldn't read the label. Try a clearer, straight-on photo." },
      422,
    )

  // Step 2: structure the transcription into JSON with the text model (JSON mode
  // is reliable for text models). Short-circuit only if the vision step already
  // returned usable JSON (it normally just describes the label).
  let direct: unknown = null
  try {
    direct = extractJson(labelText)
  } catch {
    direct = null
  }
  if (hasValues(direct)) return json(direct)

  let parsed: unknown
  let raw = ''
  try {
    // No response_format / json_schema: some models back-fill every schema
    // property as 0. The prompt already mandates JSON-only; extractJson copes.
    raw = await runWithAgree(ai, TEXT_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You convert nutrition label text into a JSON object. Output only JSON.',
        },
        { role: 'user', content: structPrompt(labelText) },
      ],
      max_tokens: 1024,
      temperature: 0,
    })
    parsed = extractJson(raw)
  } catch (e) {
    return json(
      {
        error: "Couldn't read the label. Try a clearer, straight-on photo.",
        detail:
          (e instanceof Error ? e.message : String(e)) +
          ' | read: ' +
          labelText.slice(0, 600),
      },
      422,
    )
  }

  // Structured but empty/all-zero — treat as an unreadable label rather than
  // silently zeroing the form. labelText is surfaced to aid diagnosis.
  if (!hasValues(parsed))
    return json(
      {
        error: "Couldn't read the label. Try a clearer, straight-on photo.",
        detail:
          'no values parsed | structured: ' +
          raw.slice(0, 400) +
          ' | read: ' +
          labelText.slice(0, 400),
      },
      422,
    )
  return json(parsed)
}
