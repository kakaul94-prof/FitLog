// Cloudflare Pages Function: POST /api/import-recipe
// Fetches a recipe web page server-side (a browser can't, for CORS) and turns it
// into a structured ingredient list with estimated per-ingredient nutrition via
// Claude Haiku with a strict JSON schema — the same one-call, structured-output
// pattern as scan-plate. The API key is a server-side Pages secret, so nothing
// sensitive ships to the browser. Estimates are deliberately rough: the app opens
// the result in the recipe editor for the user to review and fix.
//
// To keep the model call small + accurate we prefer the page's embedded
// schema.org JSON-LD Recipe (recipeIngredient / recipeYield / name), which most
// recipe sites ship for SEO, and fall back to stripped page text when it's absent.

interface Env {
  ANTHROPIC_API_KEY?: string
}

const MODEL = 'claude-haiku-4-5'

const PROMPT = `You are a nutrition estimator. You are given a recipe (its title, yield, and ingredient lines). Return:
- name: a short recipe title.
- servings: how many servings the recipe yields, as a number (default 1 if unclear).
- ingredients: one entry PER ingredient line. For each:
  - name: a short food name (e.g. "All-purpose flour", "Boneless chicken breast"). Drop prep words, brands, and quantities.
  - grams: the weight of the amount the recipe calls for, in grams (convert cups/tbsp/counts to a realistic gram weight).
  - kcal, protein, carb, fat: the nutrition FOR THAT AMOUNT (not per 100 g).

Rules:
- Estimate realistically; commit to a number rather than hedging. This is a rough draft the user will refine.
- Skip water and other zero-calorie items. Skip trace "to taste" seasonings (salt, pepper) that carry no meaningful calories.
- If the text is not a recipe or has no ingredients, return an empty ingredients array.
Return only the structured object.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'servings', 'ingredients'],
  properties: {
    name: { type: 'string' },
    servings: { type: 'number' },
    ingredients: {
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
  },
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })

// Structured outputs guarantee the first text block is valid JSON; parse it.
function parseContent(res: unknown): unknown {
  const r = res as { content?: Array<{ type?: string; text?: string }> }
  const text = r?.content?.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('empty response')
  return JSON.parse(text)
}

// Reject non-http(s) and obvious internal / link-local / private hosts (basic
// SSRF hygiene — this endpoint fetches an arbitrary user-supplied URL).
function safeUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
    return null
  return u
}

async function fetchPage(url: URL): Promise<string> {
  const res = await fetch(url.toString(), {
    headers: {
      // Some sites 403 an empty UA; identify as a normal client.
      'user-agent':
        'Mozilla/5.0 (compatible; FitLogRecipeBot/1.0; +https://fitlog-9wl.pages.dev)',
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`page returned ${res.status}`)
  const ct = (res.headers.get('content-type') ?? '').toLowerCase()
  if (ct && !/html|json|text|xml/.test(ct)) throw new Error('not a web page')
  const text = await res.text()
  return text.slice(0, 600_000) // cap the HTML we process
}

type JsonObj = Record<string, unknown>
const isObj = (v: unknown): v is JsonObj => !!v && typeof v === 'object'

interface RecipeLd {
  name?: string
  yield?: string
  ingredients: string[]
}

// Find a schema.org Recipe node in parsed JSON-LD: a bare object, an array of
// nodes, or an @graph wrapper.
function findRecipe(data: unknown): JsonObj | null {
  const graph = isObj(data) ? data['@graph'] : undefined
  const nodes: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(graph)
      ? graph
      : [data]
  for (const node of nodes) {
    if (!isObj(node)) continue
    const t = node['@type']
    const types = Array.isArray(t) ? t : [t]
    if (types.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe'))
      return node
  }
  return null
}

function toStringArray(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : []
  if (Array.isArray(v))
    return v
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim())
  return []
}

function yieldText(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    const first = v.find((x) => typeof x === 'string' || typeof x === 'number')
    return first != null ? String(first) : undefined
  }
  return undefined
}

// Pull recipe data out of <script type="application/ld+json"> blocks. Returns
// the first block that yields ingredients.
function extractRecipeLd(html: string): RecipeLd | null {
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue // one malformed block shouldn't sink the rest
    }
    const recipe = findRecipe(data)
    if (!recipe) continue
    const ingredients = toStringArray(recipe['recipeIngredient'])
    if (ingredients.length)
      return {
        name: typeof recipe['name'] === 'string' ? recipe['name'] : undefined,
        yield: yieldText(recipe['recipeYield']),
        ingredients,
      }
  }
  return null
}

// Fallback when there's no JSON-LD: crude tag strip, capped, so the model can
// still find a recipe in the visible text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000)
}

function buildUserContent(ld: RecipeLd | null, fallbackText: string): string {
  if (ld)
    return [
      ld.name ? `Title: ${ld.name}` : '',
      ld.yield ? `Yield: ${ld.yield}` : '',
      'Ingredients:',
      ...ld.ingredients.map((i) => `- ${i}`),
    ]
      .filter(Boolean)
      .join('\n')
  return `Recipe web page text (find the recipe within it):\n${fallbackText}`
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}): Promise<Response> => {
  const { request, env } = context
  const key = env.ANTHROPIC_API_KEY
  if (!key)
    return json({ error: 'Recipe import is not configured (no API key).' }, 503)

  let body: { url?: string }
  try {
    body = (await request.json()) as { url?: string }
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  const url = body.url ? safeUrl(body.url.trim()) : null
  if (!url)
    return json({ error: 'Enter a valid recipe link (http or https).' }, 400)

  let html: string
  try {
    html = await fetchPage(url)
  } catch (e) {
    return json(
      {
        error:
          "Couldn't open that link. Check the URL, or add the recipe manually.",
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }

  const ld = extractRecipeLd(html)
  const userContent = buildUserContent(ld, htmlToText(html))
  if (!ld && userContent.length < 120)
    return json(
      {
        error: "Couldn't read that page. Try another link, or add it manually.",
      },
      422,
    )

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
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: `${PROMPT}\n\n${userContent}` }],
      }),
    })
  } catch (e) {
    return json(
      {
        error: 'The recipe reader is unavailable right now.',
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return json(
      {
        error: 'The recipe reader is unavailable right now.',
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
        error: "Couldn't read that recipe. Try another link, or add it manually.",
        detail: e instanceof Error ? e.message : String(e),
      },
      422,
    )
  }

  return json(parsed)
}
