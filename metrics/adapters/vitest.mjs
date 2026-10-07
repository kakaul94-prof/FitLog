import path from 'node:path'
import { countStatuses } from '../lib.mjs'

const STATUS = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  pending: 'skipped',
  todo: 'skipped',
  disabled: 'skipped',
}

// 475+ unit tests × 200 runs would make the history file ~10 MB, so each run
// keeps only the slowest few plus anything that failed. Totals stay complete.
const KEEP_SLOWEST = 15

function relativeFile(file, rootDir) {
  const rel = path.relative(rootDir, file).replaceAll('\\', '/')
  // Never publish a runner's absolute path; fall back to the in-repo part.
  return rel.startsWith('..') || path.isAbsolute(rel) ? file.replace(/^.*?\/(?=src\/|metrics\/)/, '') : rel
}

/** Vitest JSON report (Jest-compatible format) → the common "tests" source block. */
export function fromVitest(report, { rootDir = process.cwd(), keepSlowest = KEEP_SLOWEST } = {}) {
  const files = report.testResults ?? []
  const all = files.flatMap((file) =>
    (file.assertionResults ?? []).map((t) => ({
      name: [...(t.ancestorTitles ?? []), t.title].join(' › '),
      file: relativeFile(file.name, rootDir),
      status: STATUS[t.status] ?? 'skipped',
      durationMs: Math.round(t.duration ?? 0),
    })),
  )
  const ends = files.map((f) => f.endTime).filter(Number.isFinite)
  const slowest = [...all].sort((a, b) => b.durationMs - a.durationMs).slice(0, keepSlowest)
  const kept = new Set([...slowest, ...all.filter((t) => t.status === 'failed')])
  return {
    kind: 'tests',
    tool: 'vitest',
    // Unit tests run without retries on purpose: they should be deterministic,
    // and a retry would hide a real bug. So "flaky" is always 0 here.
    retries: 0,
    totals: countStatuses(all),
    durationMs: ends.length ? Math.round(Math.max(...ends) - report.startTime) : 0,
    testCount: all.length,
    tests: [...kept],
  }
}
