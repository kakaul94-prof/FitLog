// Cloudflare Pages Function: POST /api/scan-plate
// Estimates the foods on a plate photo with Claude Haiku 4.5 and returns a list
// of items with rough per-portion macros. ONE structured-output call (the JSON
// schema is enforced, so no fragile parsing). The API key is a server-side Pages
// secret — nothing sensitive ships to the browser. Estimates are deliberately
// rough; the app treats them as a draft the user edits before logging.

interface Env {
  ANTHROPIC_API_KEY?: string
}

const MODEL = 'claude-haiku-4-5'

const PROMPT = `You are a nutrition estimator. Look at this photo of a plate or meal and identify each distinct food or drink. For EACH item, estimate:
- name: a short food name (e.g. "Grilled chicken breast", "White rice").
- grams: the portion actually shown, in grams (your best visual estimate).
- kcal, protein, carb, fat: the nutrition FOR THAT PORTION (not per 100 g).

Rules:
- Judge portion size from visual cues (plate and utensil size, height, density). This is a rough estimate — commit to a realistic number rather than hedging.
- Account for likely cooking fats, oils, sauces, and dressings in the calories even when you cannot see them, and state any such assumption in "note".
- Fold trivially small garnishes into the nearest item. Skip water and other zero-calorie items.
- If the image is not food, return an empty items array.
Return only the structured object.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'grams', 'kcal', 'protein', 'carb', 'fat'],
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          carb: { type: 'number' },
          fat: { type: 'number' },
        },
      },
    },
    note: { type: 'string' },
  },
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

// The model wants bare base64 — strip a data: URL prefix if one slipped in.
const bareBase64 = (b64: string) =>
  b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64

// Structured outputs guarantee the first text block is valid JSON; parse it.
function parseContent(res: unknown): unknown {
  const r = res as { content?: Array<{ type?: string; text?: string }> }
  const text = r?.content?.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('empty response')
  return JSON.parse(text)
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  const key = env.ANTHROPIC_API_KEY
  if (!key)
    return json({ error: 'Meal scanning is not configured (no API key).' }, 503)

  let body: { image?: string }
  try {
    body = (await request.json()) as { image?: string }
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (!body.image) return json({ error: 'No image provided.' }, 400)

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
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: bareBase64(body.image),
                },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    return json(
      {
        error: 'The meal reader is unavailable right now.',
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return json(
      {
        error: 'The meal reader is unavailable right now.',
        detail: detail.slice(0, 400),
      },
      502,
    )
  }

  let parsed: unknown
  try {
    parsed = parseContent(await res.json())
  } catch (e) {
    return json(
      {
        error: "Couldn't read the meal. Try a clearer, well-lit photo.",
        detail: e instanceof Error ? e.message : String(e),
      },
      422,
    )
  }

  return json(parsed)
}
