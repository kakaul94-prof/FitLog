// Cloudflare Pages Function: POST /api/scan-label
// Reads a Nutrition Facts photo with Workers AI and returns structured,
// per-serving nutrition mapped to our nutrient keys. Uses the `AI` binding —
// there is NO external API key, so nothing sensitive ships to the browser.

interface Env {
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>
  }
}

const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'

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

const PROMPT = `You read the Nutrition Facts panel in the image and return ONLY a JSON object.
Rules:
- Use the PER SERVING column, not the per-container amounts.
- Report ABSOLUTE amounts, never the % Daily Value column.
- Units per field — ${unitLine()}
- "Includes Xg Added Sugars" maps to added_sugar.
- serving_qty = the serving amount as a number; serving_unit = its text (e.g. "cup", "g", "piece"); serving_grams = the gram weight shown in parentheses, or null.
- name = the product name if it is visible in the image, otherwise "".
- If a value is missing or not legible, OMIT that key entirely. Never guess and never output 0 for a value you cannot read.
Return JSON with keys: name (string), brand (string), serving_qty (number), serving_unit (string), serving_grams (number or null), nutrients (object whose keys come ONLY from this list: ${KEYS.join(', ')}).`

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

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  if (!env.AI)
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

  const base = { image: [...bytes], prompt: PROMPT, max_tokens: 1024 }
  let result: unknown
  try {
    // Prefer schema-constrained output; fall back to plain if the model rejects
    // response_format alongside an image input.
    result = await env.AI.run(MODEL, {
      ...base,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    })
  } catch {
    try {
      result = await env.AI.run(MODEL, base)
    } catch {
      return json({ error: 'The label reader is unavailable right now.' }, 502)
    }
  }

  // Workers AI returns { response: string | object } for these models.
  const raw = (result as { response?: unknown })?.response ?? result
  try {
    const parsed = typeof raw === 'string' ? extractJson(raw) : raw
    return json(parsed)
  } catch {
    return json(
      { error: "Couldn't read the label. Try a clearer, straight-on photo." },
      422,
    )
  }
}
