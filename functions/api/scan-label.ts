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
const TEXT_MODEL = '@cf/zai-org/glm-4.7-flash'

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
const READ_PROMPT = `Read the Nutrition Facts label in this image and transcribe it precisely as plain text. Include the serving size, the servings per container, and the PER SERVING amount and unit for calories and every nutrient listed (including any vitamins and minerals). Also include the product name and brand if visible. Do not convert, round, or omit anything.`

// Step 2 — a text model turns that transcription into our JSON shape.
const structPrompt = (labelText: string) =>
  `Convert the following Nutrition Facts text into a single JSON object. Output ONLY the JSON.
Rules:
- Use the PER SERVING amounts.
- Units per field — ${unitLine()}
- "Includes Xg Added Sugars" maps to added_sugar.
- serving_qty = the serving amount as a number; serving_unit = its text (e.g. "cup", "g", "fl oz"); serving_grams = the gram weight in parentheses, or null.
- name = the product name if present, otherwise "".
- If a value is missing or unreadable, OMIT that key entirely. Never guess and never output 0 for a value that is not stated.
JSON keys: name (string), brand (string), serving_qty (number), serving_unit (string), serving_grams (number or null), nutrients (object whose keys come ONLY from this list: ${KEYS.join(', ')}).

Nutrition Facts text:
${labelText}`

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    serving_qty: { type: 'number' },
    serving_unit: { type: 'string' },
    serving_grams: { type: ['number', 'null'] },
    nutrients: {
      type: 'object',
      properties: Object.fromEntries(KEYS.map((k) => [k, { type: 'number' }])),
    },
  },
  required: ['nutrients'],
}

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
  const r = res as { response?: unknown }
  return typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? res)
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
  if (direct && typeof direct === 'object' && 'nutrients' in (direct as object))
    return json(direct)

  try {
    const out = await runWithAgree(ai, TEXT_MODEL, {
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
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    })
    return json(extractJson(out))
  } catch (e) {
    return json(
      {
        error: "Couldn't read the label. Try a clearer, straight-on photo.",
        detail:
          (e instanceof Error ? e.message : String(e)) +
          ' | read: ' +
          labelText.slice(0, 200),
      },
      422,
    )
  }
}
