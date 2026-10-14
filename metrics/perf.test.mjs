import { describe, expect, it } from 'vitest'
import { appendPerfRun, buildPerfRun, perfMarkdown, slimHeadline } from './perf.mjs'

const stats = (p95, p99) => ({ avg: p95 / 3, med: p95 / 4, p90: p95 * 0.9, p95, p99, max: p99 * 2 })

/** A headline as perf-tests/lib/summary.ts writes it, after check-run.mjs added the verdict. */
const headline = (overrides = {}) => ({
  schema: 1,
  scenario: 'load',
  reportOnly: false,
  lax: false,
  git: { sha: 'abc1234', branch: 'dev' },
  windowMs: 390_000,
  k6RunMs: 430_000,
  vusMax: 30,
  pool: 30,
  seedDays: 90,
  iterations: 1200,
  requests: { count: 9000, rps: 23.1 },
  errorRate: 0.001,
  checksRate: 0.999,
  latency: stats(180, 320),
  groups: {
    read: { latency: stats(150, 300), count: 6000, errorRate: 0, budget: { p95: 250, p99: 600 } },
    write: { latency: stats(210, 400), count: 2000, errorRate: 0.004, budget: { p95: 400, p99: 1000 } },
    signin: { latency: null, count: 0, errorRate: null, budget: null },
  },
  endpoints: {
    'diary.day': { op: 'read', p95: 120, budgetP95: 250, ok: true },
    'fn.trainer': { op: 'fn', p95: null, budgetP95: null, ok: null },
  },
  fnTtfb: { p95: 400, budget: 1000 },
  journeys: { viewDiary: { count: 500, p95Ms: 8000 } },
  phases: { firstP95: 170, lastP95: 190, drift: 1.12, driftMax: 1.25 },
  thresholds: [
    { metric: 'http_req_duration{op:read}', expr: 'p(95)<250', ok: true },
    { metric: 'http_req_duration{op:write}', expr: 'p(95)<400', ok: true },
  ],
  thresholdsPassed: 2,
  thresholdsFailed: 0,
  budgetsMet: true,
  verdict: { passed: true, enforced: true, reasons: [] },
  ...overrides,
})

describe('slimHeadline', () => {
  it('keeps the numbers and drops empty groups and unmeasured endpoints', () => {
    const s = slimHeadline(headline())
    expect(s.latency).toEqual({ avg: 60, p50: 45, p90: 162, p95: 180, p99: 320, max: 640 })
    expect(Object.keys(s.groups)).toEqual(['read', 'write'])
    expect(s.groups.write).toEqual({ p95: 210, p99: 400, errorRate: 0.004, count: 2000, budget: { p95: 400, p99: 1000 } })
    expect(Object.keys(s.endpoints)).toEqual(['diary.day'])
    expect(s.thresholds).toEqual({ total: 2, failed: [] })
    expect(s.passed).toBe(true)
  })

  it('reads the verdict check-run.mjs wrote, falling back to the budgets', () => {
    const failed = slimHeadline(headline({ verdict: { passed: false, enforced: true, reasons: ['1 threshold(s) breached: x'] } }))
    expect(failed.passed).toBe(false)
    expect(failed.reasons).toEqual(['1 threshold(s) breached: x'])
    const noVerdict = slimHeadline(headline({ verdict: undefined, budgetsMet: false, reportOnly: true }))
    expect(noVerdict).toMatchObject({ passed: false, enforced: false })
  })

  it('lists breached thresholds by name', () => {
    const s = slimHeadline(headline({ thresholds: [{ metric: 'http_req_duration{op:search}', expr: 'p(95)<200', ok: false }] }))
    expect(s.thresholds.failed).toEqual(['http_req_duration{op:search} p(95)<200'])
  })
})

describe('buildPerfRun', () => {
  const env = { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'deadbeef', GITHUB_REF_NAME: 'dev', GITHUB_EVENT_NAME: 'schedule' }

  it('holds one slim headline per scenario and the run identifiers', () => {
    const run = buildPerfRun({ env, headlines: [headline(), headline({ scenario: 'soak' })], now: new Date('2026-10-14T07:00:00Z') })
    expect(run).toMatchObject({ id: '42-2', sha: 'deadbeef', branch: 'dev', event: 'schedule', runUrl: 'https://github.com/o/r/actions/runs/42' })
    expect(Object.keys(run.scenarios)).toEqual(['load', 'soak'])
    expect(JSON.stringify(run)).not.toContain('supabase')
  })

  it('falls back to the headline git metadata outside CI', () => {
    const run = buildPerfRun({ env: {}, headlines: [headline()] })
    expect(run).toMatchObject({ id: 'local-1', sha: 'abc1234', branch: 'dev', runUrl: null })
  })
})

describe('appendPerfRun', () => {
  it('replaces a re-run of the same attempt and caps the history', () => {
    const run = (id) => ({ id, timestamp: `2026-10-${String(10 + Number(id)).padStart(2, '0')}T00:00:00Z`, scenarios: {} })
    let history = appendPerfRun(null, run('1'))
    history = appendPerfRun(history, run('2'))
    history = appendPerfRun(history, run('2'))
    expect(history.runs.map((r) => r.id)).toEqual(['1', '2'])
    const capped = appendPerfRun(history, run('3'), 2)
    expect(capped.runs.map((r) => r.id)).toEqual(['2', '3'])
    expect(capped.updated).toBe(run('3').timestamp)
  })
})

describe('perfMarkdown', () => {
  it('summarises each scenario and its groups', () => {
    const md = perfMarkdown(buildPerfRun({ env: {}, headlines: [headline()] }))
    expect(md).toContain('✅ Performance')
    expect(md).toContain('| load | ✅ passed | 30 | 23.1 | 45 ms | 180 ms | 320 ms | 0.10% | 2/2 |')
    expect(md).toContain('| read | 150 ms | 300 ms | 250 / 600 ms | 0.00% | 6000 |')
    expect(md).toContain('= **1.12×** (limit 1.25×)')
  })

  it('marks a breached report-only scenario as such, and a failed one as failed', () => {
    const reportOnly = headline({ scenario: 'stress', reportOnly: true, verdict: { passed: true, enforced: false, reasons: ['2 threshold(s) breached: a; b'] } })
    expect(perfMarkdown(buildPerfRun({ env: {}, headlines: [reportOnly] }))).toContain('| stress | 📊 report-only |')
    const failed = headline({ verdict: { passed: false, enforced: true, reasons: ['latency drifted'] } })
    const md = perfMarkdown(buildPerfRun({ env: {}, headlines: [failed] }))
    expect(md).toContain('❌ Performance')
    expect(md).toContain('| load | ❌ failed |')
    expect(md).toContain('- latency drifted')
  })
})
