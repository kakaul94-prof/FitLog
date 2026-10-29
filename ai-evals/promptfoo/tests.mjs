// promptfoo test generator: the custom suite's golden cases, read from
// ai-evals/dataset/*.yaml at run time. Nothing is copied: a case added or
// changed there is a case added or changed here.
//
// How each part of a case maps (ai-evals/aievals/dataset.py has the schema):
//
//   ask, history          vars.ask, vars.history -> the provider's request body
//   persona, seed         vars.context_key -> the log and memory in contexts.json
//   expect.contains_any   icontains-any                 (built-in)
//   expect.not_contains   not-icontains, one per needle (built-in)
//   expect.not_matches    javascript notMatches, one per pattern (Python regex flags)
//   expect.numbers_include  javascript numbersInclude
//   expect.no_prompt_leak   javascript noPromptLeak (8-word runs of the rules sent)
//   expect.no_secrets       javascript noSecrets
//   expect.remember*        javascript remember* (the chip the app's parser offers)
//   judge: [rubric]       llm-rubric, the rubric file's text as the rubric, plus
//                         the question and (for the two log rubrics) the log
//   pair (fairness)       metadata only: group scoring is cross-test, which
//                         promptfoo has no notion of (see README)
//
// Every assertion carries a `metric` (rule:<check> or judge:<rubric>), so the
// report can split rule checks from judged ones, as the custom gates do.
//
// Selection, from the environment (run.mjs sets it):
//   PF_SET       golden (all 87) | redteam (the three security categories) | canary (the 10 canary cases)
//   PF_ONLY      case ids, space- or comma-separated
//   PF_CATEGORY  one category
//   PF_JUDGE     0 to leave out the llm-rubric assertions (stub runs)
//   PF_TODAY     the date logs are rendered for (default: today)
import { readFileSync, readdirSync } from 'node:fs'
import yaml from 'js-yaml'
import { AI_EVALS, checkFixture, contextKey, loadContexts, localToday, renderContext } from './lib/contexts.mjs'

export const REDTEAM = ['prompt_injection', 'information_exposure', 'unintended_actions']
// Rubrics that compare the reply with the user's log (aievals/judge.py NEEDS_LOG).
const NEEDS_LOG = new Set(['no_fabrication', 'grounded_in_log'])
const EXPECT_KEYS = new Set([
  'contains_any',
  'not_contains',
  'not_matches',
  'numbers_include',
  'no_prompt_leak',
  'no_secrets',
  'remember',
  'remember_not_containing',
  'remember_containing_any',
])

// Checked against facts computed from the seeded user's rows (aievals/facts.py
// and factcheck.py), which this layer doesn't port; they run in the custom suite.
const NOT_PORTED = new Set(['personas.yaml', 'grounding.yaml'])

/** Every case in dataset/*.yaml, in the custom loader's order (files sorted by name). */
export function loadCases() {
  const dir = `${AI_EVALS}dataset/`
  const cases = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
    if (NOT_PORTED.has(name)) continue
    const doc = yaml.load(readFileSync(dir + name, 'utf8'))
    for (const raw of doc.cases) cases.push({ persona: 'sam', ...raw, category: doc.category })
  }
  return cases
}

export function canaryIds() {
  return yaml.load(readFileSync(`${AI_EVALS}canary/cases.yaml`, 'utf8')).cases.map((c) => c.id)
}

export function select({ set = 'golden', only = [], category = '' } = {}) {
  let cases = loadCases()
  if (set === 'redteam') cases = cases.filter((c) => REDTEAM.includes(c.category))
  else if (set === 'canary') {
    const ids = canaryIds()
    cases = ids.map((id) => cases.find((c) => c.id === id))
  } else if (set !== 'golden') throw new Error(`unknown set ${set}: golden, redteam or canary`)
  if (only.length) {
    const unknown = only.filter((id) => !cases.some((c) => c.id === id))
    if (unknown.length) throw new Error(`unknown case ids: ${unknown.join(', ')}`)
    cases = cases.filter((c) => only.includes(c.id))
  }
  if (category) cases = cases.filter((c) => c.category === category)
  return cases
}

export function rubricText(rubric) {
  const text = readFileSync(`${AI_EVALS}rubrics/${rubric}.md`, 'utf8')
  // The rubric goes into a Nunjucks template; it must not be read as one.
  if (/\{[{%#]/.test(text)) throw new Error(`rubrics/${rubric}.md contains template syntax`)
  return text.trim()
}

/** An llm-rubric assertion: the rubric file, the question and, where the rubric needs it, the log. */
export function rubricAssertion(rubric) {
  const parts = [rubricText(rubric), "The user's question:\n{{ ask }}"]
  if (NEEDS_LOG.has(rubric)) parts.push("LOG (the user's training log and saved memory):\n{{ judge_log }}")
  return {
    type: 'llm-rubric',
    value: parts.join('\n\n'),
    metric: `judge:${rubric}`,
    // The grader reads what the user would see: the bubble plus any chip
    // (aievals/live.py shown_to_judge), from the app's own parser.
    transform: 'file://judged.mjs',
  }
}

const js = (fn, check, config = {}) => ({
  type: 'javascript',
  value: `file://asserts.mjs:${fn}`,
  config,
  metric: `rule:${check}`,
})

export function ruleAssertions(expect = {}) {
  const unknown = Object.keys(expect).filter((k) => !EXPECT_KEYS.has(k))
  if (unknown.length) throw new Error(`unmapped expect keys: ${unknown.join(', ')}`)
  const out = []
  if (expect.contains_any?.length)
    out.push({ type: 'icontains-any', value: expect.contains_any.map(String), metric: 'rule:contains_any' })
  for (const needle of expect.not_contains ?? [])
    out.push({ type: 'not-icontains', value: String(needle), metric: 'rule:not_contains' })
  for (const pattern of expect.not_matches ?? []) out.push(js('notMatches', 'not_matches', { pattern }))
  if (expect.numbers_include?.length)
    out.push(js('numbersInclude', 'numbers_include', { numbers: expect.numbers_include }))
  if (expect.no_prompt_leak) out.push(js('noPromptLeak', 'no_prompt_leak'))
  if (expect.no_secrets) out.push(js('noSecrets', 'no_secrets'))
  if (expect.remember === 'none') out.push(js('rememberNone', 'remember_none'))
  if (expect.remember_not_containing?.length)
    out.push(js('rememberNotContaining', 'remember_not_containing', { needles: expect.remember_not_containing }))
  if (expect.remember_containing_any?.length)
    out.push(js('rememberContainingAny', 'remember_containing_any', { needles: expect.remember_containing_any }))
  return out
}

/** What the custom judge is shown as the log: the snapshot and the saved memory (live.py judge_log). */
export function judgeLog(context, memory) {
  if (!memory.length) return context
  return `${context}\n\nSaved memory (facts from past chats):\n${memory.map((m) => `- ${m}`).join('\n')}`
}

export function buildTests({ set, only, category, judge = true, today = localToday() } = {}) {
  const cases = select({ set, only, category })
  for (const warning of checkFixture(cases)) process.stderr.write(`warning: ${warning}\n`)
  const fixture = loadContexts()
  return cases.map((c) => {
    const key = contextKey(c)
    const rubrics = judge ? (c.judge ?? []) : []
    const vars = {
      case_id: c.id,
      ask: c.ask,
      history: c.history?.length ? JSON.stringify(c.history) : '',
      context_key: key,
      today,
    }
    if (rubrics.some((r) => NEEDS_LOG.has(r))) {
      const entry = fixture.entries[key]
      vars.judge_log = judgeLog(renderContext(entry.context, today), entry.memory)
    }
    return {
      description: `${c.id}: ${c.title}`,
      vars,
      assert: [...ruleAssertions(c.expect), ...rubrics.map(rubricAssertion)],
      metadata: {
        case_id: c.id,
        category: c.category,
        kind: c.kind,
        redteam: String(REDTEAM.includes(c.category)),
        seeded: String(Boolean(c.seed)),
        rubrics: (c.judge ?? []).join(' '),
        pair_group: c.pair?.group ?? '',
        pair_variant: c.pair?.variant ?? '',
      },
    }
  })
}

export default async function generate() {
  const env = process.env
  return buildTests({
    set: env.PF_SET || 'golden',
    only: (env.PF_ONLY ?? '').split(/[\s,]+/).filter(Boolean),
    category: env.PF_CATEGORY ?? '',
    judge: env.PF_JUDGE !== '0',
    today: env.PF_TODAY || localToday(),
  })
}
