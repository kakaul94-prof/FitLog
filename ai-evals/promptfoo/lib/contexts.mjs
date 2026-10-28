// The trainer's inputs: contexts.json, built by `python -m aievals.contexts`.
//
// The custom suite seeds a synthetic user into the local Supabase stack per
// run and builds the log snapshot with the app's own trainerContext.ts. That
// needs Docker; promptfoo runs shouldn't. So the same builder runs once, ahead
// of time, and its output is kept here with every date made relative
// ({{today-2}}), like the production canary's snapshot. One entry per persona
// (unseeded cases share one) and one per seeded case (its hostile text
// planted in the log or memory).
//
// Staleness is checked, not assumed: a seeded case whose seed changed since
// the fixture was built, or a changed personas.yaml, stops the run; a changed
// trainerContext.ts is reported (the log reads as an older build wrote it).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
export const CONTEXTS = here('../contexts.json')
export const AI_EVALS = here('../../')
export const REPO = here('../../../')
const SOURCES = {
  'personas.yaml': `${AI_EVALS}dataset/personas.yaml`,
  'trainerContext.ts': `${REPO}src/lib/trainerContext.ts`,
}

let cached

export function loadContexts() {
  cached ??= JSON.parse(readFileSync(CONTEXTS, 'utf8'))
  return cached
}

/** sha256 of a text file with line endings normalised (a Windows checkout hashes the same). */
export function fileHash(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** JSON with sorted keys and no spaces: matches json.dumps(sort_keys=True, separators=(",", ":")). */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** What a seeded case's entry was built from: its persona and its hostile text. */
export function seedHash(persona, seed) {
  return createHash('sha256').update(canonical({ persona, seed }), 'utf8').digest('hex')
}

/** The fixture key a case reads its log from. */
export const contextKey = (c) => (c.seed ? `case:${c.id}` : `persona:${c.persona ?? 'sam'}`)

/** Stops on a fixture that can't answer these cases; returns warnings for the rest. */
export function checkFixture(cases) {
  const fixture = loadContexts()
  const problems = []
  const warnings = []
  if (fixture.sources?.['personas.yaml'] !== fileHash(SOURCES['personas.yaml']))
    problems.push('dataset/personas.yaml has changed since contexts.json was built')
  if (fixture.sources?.['trainerContext.ts'] !== fileHash(SOURCES['trainerContext.ts']))
    warnings.push(
      `src/lib/trainerContext.ts has changed since contexts.json was built (${fixture.generated}); ` +
        'the logs read as that build wrote them',
    )
  for (const c of cases) {
    const entry = fixture.entries[contextKey(c)]
    if (!entry) problems.push(`no ${contextKey(c)} entry`)
    else if (c.seed && entry.seed_hash !== seedHash(c.persona ?? 'sam', c.seed))
      problems.push(`${c.id}'s seed has changed since contexts.json was built`)
  }
  if (problems.length)
    throw new Error(
      `contexts.json is stale: ${problems.join('; ')}. Rebuild it with the local stack up: npm run eval:pf:contexts`,
    )
  return warnings
}

/** The snapshot as it would read if the app built it on `today` (YYYY-MM-DD). */
export function renderContext(template, today) {
  const base = new Date(`${today}T00:00:00Z`)
  return template.replace(/\{\{today(?:([+-])(\d+))?\}\}/g, (_, sign, days) => {
    const d = new Date(base)
    if (sign) d.setUTCDate(d.getUTCDate() + (sign === '-' ? -1 : 1) * Number(days))
    return d.toISOString().slice(0, 10)
  })
}

/** Today in the machine's local time zone, as the app's todayISO() would give it. */
export function localToday() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
