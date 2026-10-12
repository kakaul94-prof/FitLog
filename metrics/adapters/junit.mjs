import { countStatuses } from '../lib.mjs'

// JUnit XML (pytest --junitxml, as the API suite writes it) → the shared
// `kind: 'tests'` source block.
//
// pytest's JUnit output is flat and regular (testsuite > testcase, with an
// optional failure / error / skipped child and escaped attributes), so a small
// reader is enough and keeps the metrics job free of npm installs. The API
// suite runs without retries, so a test either passed or it didn't: nothing is
// "flaky" here by construction.

const KEEP_SLOWEST = 15
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, e) => {
    if (e[0] !== '#') return ENTITIES[e] ?? match
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  })
}

function attributes(tagText) {
  const out = {}
  for (const [, key, value] of tagText.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[key] = unescapeXml(value)
  return out
}

/** "tests.auth.test_sign_in" → "api-tests/tests/auth/test_sign_in.py" (repo-relative). */
function fileOf(classname = '', root = 'api-tests') {
  const parts = classname.split('.')
  const module = parts.findLastIndex((p) => p.startsWith('test_'))
  const path = (module >= 0 ? parts.slice(0, module + 1) : parts).join('/')
  return path ? `${root}/${path}.py` : root
}

/** One row per <testcase>; its outcome comes from its child element, if any. */
export function junitTests(xml, { root } = {}) {
  const tests = []
  for (const [, head, , body = ''] of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attributes(head)
    const status = /<(failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed'
    tests.push({ name: a.name, file: fileOf(a.classname, root), status, durationMs: Math.round(Number(a.time ?? 0) * 1000) })
  }
  return tests
}

export function fromJUnit(xml, { tool = 'pytest', root, keepSlowest = KEEP_SLOWEST } = {}) {
  const all = junitTests(xml, { root })
  // <testsuite time> is the whole session's wall clock (parallel workers included).
  const suiteTimes = [...xml.matchAll(/<testsuite\b([^>]*)>/g)].map(([, head]) => Number(attributes(head).time ?? 0))
  const slowest = [...all].sort((a, b) => b.durationMs - a.durationMs).slice(0, keepSlowest)
  const kept = new Set([...slowest, ...all.filter((t) => t.status === 'failed')])
  return {
    kind: 'tests',
    tool,
    retries: 0,
    totals: countStatuses(all),
    durationMs: Math.round(Math.max(0, ...suiteTimes) * 1000),
    testCount: all.length,
    tests: [...kept],
  }
}
