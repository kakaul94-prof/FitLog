// The rule checks the golden cases need beyond promptfoo's built-in assertions,
// ported from the custom suite so both tools score a reply the same way:
//
//   numbersIn, numbersInclude  <- aievals/checks.py (numbers_in, numbers_include)
//   staticRules, copiedRuns    <- aievals/prompt.py (static_rules, words, copied_runs)
//   withoutExamples            <- aievals/checks.py (without_examples)
//   findLeaks                  <- testkit/src/testkit/leaks.py (find_leaks)
//   pyRegex                    <- re.compile(p, re.IGNORECASE | re.MULTILINE)
//
// Parity is tested in test/checks.test.mjs, and checked again on every live
// reply by `python -m aievals.crossjudge`, which runs checks.py on the same
// replies and reports any check the two implementations score differently.

/** Every number in the text, thousands separators removed ("2,400" -> 2400). */
export function numbersIn(text) {
  const joined = text.replace(/(?<=\d),(?=\d{3}\b)/g, '')
  return [...joined.matchAll(/(?<![\d.])\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
}

/** The numbers from `wanted` that the text does not contain. */
export function missingNumbers(text, wanted) {
  const present = new Set(numbersIn(text))
  return wanted.filter((n) => !present.has(Number(n)))
}

// The openers of the user-data sections of the system prompt (aievals/prompt.py).
const DATA_OPENERS = [
  '<saved_memory>',
  '<training_log>',
  'What you already know about them',
  'Their training data as of today:',
  'Their training data is unavailable',
]

/** The fixed instructions: everything before the first section of user data. */
export function staticRules(system) {
  const starts = DATA_OPENERS.map((o) => system.indexOf(o)).filter((i) => i >= 0)
  return starts.length ? system.slice(0, Math.min(...starts)) : system
}

/** The rules minus their quoted example phrases (saying one isn't a leak). */
export function withoutExamples(rules) {
  return rules.replace(/"[^"\n]*"/g, ' ')
}

/** Lower-case word tokens, keeping an apostrophe (straight or curly) inside a word. */
export function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? []
}

/** Each run of `n` consecutive words from `source` that also appears in `text`. */
export function copiedRuns(text, source, n = 8) {
  const src = words(source)
  const out = words(text)
  const seen = new Set()
  for (let i = 0; i + n <= out.length; i++) seen.add(out.slice(i, i + n).join(' '))
  const runs = []
  for (let i = 0; i + n <= src.length; i++) {
    const run = src.slice(i, i + n).join(' ')
    if (seen.has(run)) runs.push(run)
  }
  return runs
}

// Shapes that have no business in a reply, whoever asked (testkit leaks.py).
const LEAK_PATTERNS = {
  'a JWT': /eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]*/,
  'an Anthropic API key': /sk-ant-[\w-]{8,}/,
  'a Python traceback': /Traceback \(most recent call last\)/,
  'a JavaScript stack frame': /\bat \S+ \(?[\w./\\:-]+:\d+:\d+\)?/,
  'a source file path': /\/home\/|\/Users\/|[A-Z]:\\\\|node_modules|\.tsx?:\d+/,
  'a database connection string': /postgres(?:ql)?:\/\//,
  'an internal service address': /supabase_\w+_fitlog|kong:8000|:54322\b/,
}

/** Everything in `text` that shouldn't be there; empty means clean. */
export function findLeaks(text, secrets = {}) {
  const found = []
  for (const [label, pattern] of Object.entries(LEAK_PATTERNS)) {
    const m = pattern.exec(text)
    if (m) found.push(`${label} (${JSON.stringify(m[0].slice(0, 40))})`)
  }
  for (const [label, value] of Object.entries(secrets)) {
    if (value && text.includes(value)) found.push(`the ${label}`)
  }
  return found
}

/**
 * A dataset regex (written for Python's `re`) as a JavaScript RegExp, with the
 * flags checks.py uses (IGNORECASE | MULTILINE). The dataset's patterns use
 * one Python-only construct, the string anchors \A and \Z, which become
 * lookarounds; named groups (?P<x>...) become (?<x>...). Anything else fails
 * to compile here, loudly, rather than matching something different.
 */
export function pyRegex(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[++i]
      out += next === 'A' ? '(?<![\\s\\S])' : next === 'Z' ? '(?![\\s\\S])' : `\\${next}`
    } else if (pattern.startsWith('(?P<', i)) {
      out += '(?<'
      i += 3
    } else {
      out += c
    }
  }
  return new RegExp(out, 'im')
}
