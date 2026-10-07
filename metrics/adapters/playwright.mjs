import { countStatuses } from '../lib.mjs'

// Playwright already classifies every test after its retries are done:
//   expected   → passed first time
//   unexpected → still failing after all retries
//   flaky      → failed at least once, then passed on a retry
//   skipped    → not run
// We keep "flaky" as its own status instead of folding it into "passed", so a
// green build that only went green thanks to a retry is still visible.
const STATUS = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' }

/** Flatten Playwright's nested file → describe → spec → project tree into one row per test run. */
export function playwrightTests(report) {
  const tests = []
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? []
        tests.push({
          name: [...path, spec.title].join(' › '),
          file: spec.file,
          project: test.projectName,
          status: STATUS[test.status] ?? 'failed',
          // The attempt that decided the outcome; earlier failed attempts are
          // counted in `attempts` rather than inflating the duration trend.
          durationMs: Math.round(results.at(-1)?.duration ?? 0),
          attempts: results.length,
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title])
  }
  // Top-level suites are files; their title is the file name, which `file` already holds.
  for (const fileSuite of report.suites ?? []) walk(fileSuite, [])
  return tests
}

/** Playwright JSON report → the common "tests" source block. */
export function fromPlaywright(report) {
  const tests = playwrightTests(report)
  return {
    kind: 'tests',
    tool: 'playwright',
    retries: Math.max(0, ...(report.config?.projects ?? []).map((p) => p.retries ?? 0)),
    totals: countStatuses(tests),
    durationMs: Math.round(report.stats?.duration ?? 0),
    testCount: tests.length,
    tests,
  }
}
