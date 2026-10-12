import { describe, expect, it } from 'vitest'
import { fromJUnit } from './adapters/junit.mjs'
import { fromPlaywright } from './adapters/playwright.mjs'
import { fromVitest } from './adapters/vitest.mjs'
import { aggregateRepeats, appendRun, buildRun, feedbackMs, runStatus } from './lib.mjs'

// Trimmed-down Playwright JSON report: one passing, one flaky (failed, then
// passed on retry), one failing after all retries, one skipped.
const result = (status, duration) => ({ status, duration, retry: 0 })
const playwrightReport = {
  config: { projects: [{ name: 'setup', retries: 2 }, { name: 'mobile-chromium', retries: 2 }] },
  stats: { duration: 61234.5 },
  suites: [
    {
      title: 'tests/diary.spec.ts',
      specs: [
        {
          title: 'logs a meal',
          file: 'tests/diary.spec.ts',
          tests: [{ projectName: 'mobile-chromium', status: 'flaky', results: [result('failed', 30000), result('passed', 4200)] }],
        },
      ],
      suites: [
        {
          title: 'sign in',
          specs: [
            { title: 'works', file: 'tests/diary.spec.ts', tests: [{ projectName: 'mobile-chromium', status: 'expected', results: [result('passed', 1500)] }] },
            { title: 'breaks', file: 'tests/diary.spec.ts', tests: [{ projectName: 'mobile-chromium', status: 'unexpected', results: [result('failed', 900), result('failed', 800), result('failed', 700)] }] },
            { title: 'later', file: 'tests/diary.spec.ts', tests: [{ projectName: 'mobile-chromium', status: 'skipped', results: [] }] },
          ],
        },
      ],
    },
  ],
}

describe('fromPlaywright', () => {
  const e2e = fromPlaywright(playwrightReport)

  it('records a test that passed only on retry as flaky, not passed', () => {
    expect(e2e.totals).toEqual({ passed: 1, failed: 1, flaky: 1, skipped: 1 })
    const flaky = e2e.tests.find((t) => t.status === 'flaky')
    expect(flaky).toMatchObject({ name: 'logs a meal', attempts: 2 })
  })

  it('uses the deciding attempt for duration, and the describe path in the name', () => {
    expect(e2e.tests.find((t) => t.status === 'flaky').durationMs).toBe(4200)
    expect(e2e.tests.map((t) => t.name)).toContain('sign in › works')
    expect(e2e.durationMs).toBe(61235)
    expect(e2e.retries).toBe(2)
  })
})

describe('fromVitest', () => {
  const root = '/home/runner/work/FitLog/FitLog'
  const assertion = (title, status, duration) => ({ ancestorTitles: ['calc'], title, status, duration })
  const report = {
    startTime: 1000,
    testResults: [
      {
        name: `${root}/src/lib/calc.test.ts`,
        endTime: 3500,
        assertionResults: [
          assertion('slow', 'passed', 50),
          assertion('fast', 'passed', 1),
          assertion('broken', 'failed', 0.2),
          assertion('todo', 'todo', 0),
        ],
      },
    ],
  }
  const unit = fromVitest(report, { rootDir: root, keepSlowest: 1 })

  it('keeps complete totals but stores only the slowest tests plus failures', () => {
    expect(unit.totals).toEqual({ passed: 2, failed: 1, flaky: 0, skipped: 1 })
    expect(unit.testCount).toBe(4)
    expect(unit.tests.map((t) => t.name).sort()).toEqual(['calc › broken', 'calc › slow'])
  })

  it('publishes repo-relative paths, never the runner path', () => {
    expect(unit.tests[0].file).toBe('src/lib/calc.test.ts')
    expect(fromVitest(report, { rootDir: '/elsewhere' }).tests[0].file).toBe('src/lib/calc.test.ts')
    expect(unit.durationMs).toBe(2500)
  })
})

describe('history', () => {
  const env = { GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc', GITHUB_REF_NAME: 'dev' }
  const run = buildRun({ env, sources: { e2e: fromPlaywright(playwrightReport) }, jobs: { e2e: 'failure' } })

  it('caps history at the newest runs and replaces a re-published run', () => {
    const old = { runs: Array.from({ length: 5 }, (_, i) => ({ id: `${i}-1` })) }
    const next = appendRun(old, run, 3)
    expect(next.runs.map((r) => r.id)).toEqual(['3-1', '4-1', '9-1'])
    expect(appendRun(next, run, 3).runs).toHaveLength(3)
  })

  it('marks a run failed when a job failed, even with no failing test', () => {
    expect(runStatus({ sources: {}, jobs: { e2e: 'failure' } })).toBe('failed')
    expect(runStatus({ sources: {}, jobs: { e2e: 'success' } })).toBe('passed')
    expect(run.runUrl).toBe('https://github.com/o/r/actions/runs/9')
  })
})

describe('aggregateRepeats (flake hunt)', () => {
  it('ranks tests by how many of their repeats failed', () => {
    const t = (name, status, durationMs) => ({ name, file: 'f.ts', project: 'p', status, durationMs })
    const rows = aggregateRepeats([t('a', 'passed', 10), t('b', 'failed', 50), t('a', 'passed', 30), t('b', 'passed', 20)])
    expect(rows[0]).toMatchObject({ name: 'b', runs: 2, failures: 1, failRate: 0.5, maxMs: 50 })
    expect(rows[1]).toMatchObject({ name: 'a', failures: 0, medianMs: 30 })
  })
})

// Trimmed pytest JUnit report: a pass, a failure, an error, a skip, and a name
// with escaped characters (parametrize ids carry quotes and brackets).
const junitReport = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">
<testsuite name="api" errors="1" failures="1" skipped="1" tests="5" time="42.5">
<testcase classname="tests.auth.test_tokens" name="test_refused[alg-none]" time="0.120" />
<testcase classname="tests.validation.test_constraints" name="test_range[effort=0 &quot;refused&quot;]" time="1.5">
  <failure message="assert 201 == 400">AssertionError: 201 &gt; 200</failure>
</testcase>
<testcase classname="tests.functions.test_trainer" name="test_streams" time="2"><error message="boom">setup failed</error></testcase>
<testcase classname="tests.bdd.test_journeys" name="test_weighing_in" time="0.01"><skipped message="no stack" /></testcase>
<testcase classname="tests.authz.test_rls_api" name="test_read[foods]" time="0.300"></testcase>
</testsuite></testsuites>`

describe('fromJUnit', () => {
  it('reads each outcome from the test case and the wall clock from the suite', () => {
    const block = fromJUnit(junitReport)
    expect(block).toMatchObject({ kind: 'tests', tool: 'pytest', retries: 0, testCount: 5, durationMs: 42500 })
    expect(block.totals).toEqual({ passed: 2, failed: 2, flaky: 0, skipped: 1 })
  })

  it('unescapes names and maps module paths to repo-relative files', () => {
    const failed = fromJUnit(junitReport).tests.find((t) => t.name.startsWith('test_range'))
    expect(failed).toEqual({
      name: 'test_range[effort=0 "refused"]',
      file: 'api-tests/tests/validation/test_constraints.py',
      status: 'failed',
      durationMs: 1500,
    })
  })

  it('keeps every failure even when it is not among the slowest', () => {
    const kept = fromJUnit(junitReport, { keepSlowest: 1 }).tests.map((t) => t.status)
    expect(kept.filter((s) => s === 'failed')).toHaveLength(2)
  })
})

describe('feedbackMs', () => {
  const now = new Date('2026-10-12T12:10:00Z')

  it('measures from a push (epoch seconds) or a PR update (ISO date)', () => {
    expect(feedbackMs(String(Date.parse('2026-10-12T12:04:00Z') / 1000), now)).toBe(6 * 60 * 1000)
    expect(feedbackMs('2026-10-12T12:08:30Z', now)).toBe(90 * 1000)
  })

  it('is null when the trigger time is missing or nonsense', () => {
    expect(feedbackMs(undefined, now)).toBeNull()
    expect(feedbackMs('', now)).toBeNull()
    expect(feedbackMs('not a date', now)).toBeNull()
    expect(feedbackMs('2099-01-01T00:00:00Z', now)).toBeNull() // clock skew: never negative
  })

  it('is stored on the run record', () => {
    const run = buildRun({ env: { TRIGGERED_AT: '2026-10-12T12:09:00Z' }, sources: {}, now })
    expect(run.feedbackMs).toBe(60 * 1000)
  })
})
