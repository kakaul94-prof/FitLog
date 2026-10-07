import { describe, expect, it } from 'vitest'
import { fromPlaywright } from './adapters/playwright.mjs'
import { fromVitest } from './adapters/vitest.mjs'
import { aggregateRepeats, appendRun, buildRun, runStatus } from './lib.mjs'

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
