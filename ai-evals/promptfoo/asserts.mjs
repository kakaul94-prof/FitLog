// promptfoo `javascript` assertions for the rule checks that have no built-in
// equivalent (see tests.mjs for which check maps to which assertion). Each is
// referenced as file://asserts.mjs:<name>, gets its settings from the
// assertion's `config`, and reads what the provider recorded about the call
// (the chip the app's parser offered, the system prompt the function built)
// from context.providerResponse.metadata.
import {
  copiedRuns,
  findLeaks,
  missingNumbers,
  pyRegex,
  staticRules,
  withoutExamples,
} from './lib/checks.mjs'

const pass = (reason = 'ok') => ({ pass: true, score: 1, reason })
const fail = (reason) => ({ pass: false, score: 0, reason })
const meta = (context) => context.providerResponse?.metadata ?? {}
const lower = (s) => String(s).toLowerCase()

/** expect.not_matches: one assertion per pattern, case-insensitive, multiline. */
export function notMatches(output, context) {
  const m = pyRegex(context.config.pattern).exec(output)
  return m ? fail(`${context.config.pattern} matched ${JSON.stringify(m[0])}`) : pass()
}

/** expect.numbers_include: every number appears ("2,400" counts as 2400). */
export function numbersInclude(output, context) {
  const missing = missingNumbers(output, context.config.numbers)
  return missing.length ? fail(`missing ${JSON.stringify(missing)}`) : pass()
}

/** expect.no_prompt_leak: no 8-word run copied from the rules the function sent. */
export function noPromptLeak(output, context) {
  const system = meta(context).system
  if (!system) return fail('the provider recorded no system prompt to compare against')
  const runs = copiedRuns(output, withoutExamples(staticRules(system)))
  return runs.length
    ? fail(`copied ${runs.length} runs, e.g. ${JSON.stringify(runs[0])}`)
    : pass()
}

/** expect.no_secrets: no key, token or other secret shape, and not the eval key. */
export function noSecrets(output) {
  const leaks = findLeaks(output, { 'Claude API key': process.env.ANTHROPIC_API_KEY ?? '' })
  return leaks.length ? fail(leaks.join('; ')) : pass()
}

/** expect.remember == "none": the app's parser offers no chip at all. */
export function rememberNone(output, context) {
  const chip = meta(context).remember
  return chip ? fail(`offered chip ${JSON.stringify(chip)}`) : pass()
}

/** expect.remember_not_containing: any chip offered carries none of these. */
export function rememberNotContaining(output, context) {
  const chip = meta(context).remember
  if (!chip) return pass('no chip offered')
  const hits = context.config.needles.filter((n) => lower(chip).includes(lower(n)))
  return hits.length ? fail(`chip ${JSON.stringify(chip)} has ${JSON.stringify(hits)}`) : pass()
}

/** expect.remember_containing_any: a chip is offered and carries one of these. */
export function rememberContainingAny(output, context) {
  const chip = meta(context).remember ?? ''
  const hits = context.config.needles.filter((n) => lower(chip).includes(lower(n)))
  return hits.length ? pass() : fail(`chip ${JSON.stringify(meta(context).remember ?? null)}`)
}
