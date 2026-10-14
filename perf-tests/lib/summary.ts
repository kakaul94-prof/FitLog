// The end-of-run report: a headline record (reports/perf/<scenario>/headline.json,
// what the quality dashboard and scripts/check-run.mjs read), k6's full summary
// (summary.json) and a short text table on stdout.
import { ENDPOINTS, type Op } from '../config/endpoints.ts'
import type { Profile } from '../config/profiles.ts'
import { FN_TTFB, LATENCY, SOAK_DRIFT_MAX } from '../config/thresholds.ts'

export interface Metric {
  type: 'trend' | 'counter' | 'rate' | 'gauge'
  contains: string
  values: Record<string, number>
  thresholds?: Record<string, { ok: boolean }>
}

/** The part of k6's handleSummary `data` this report reads. */
export interface SummaryData {
  metrics: Record<string, Metric>
  state: { testRunDurationMs: number }
}

export interface Stats {
  avg: number
  med: number
  p90: number
  p95: number
  p99: number
  max: number
}

export interface GroupStats {
  latency: Stats | null
  count: number
  errorRate: number | null
  budget: { p95: number; p99: number } | null
}

export interface ThresholdResult {
  metric: string
  expr: string
  ok: boolean
}

export interface Headline {
  schema: 1
  scenario: string
  reportOnly: boolean
  lax: boolean
  git: { sha: string; branch: string }
  startedAt: string
  finishedAt: string
  k6RunMs: number
  /** The configured run (ramps + holds), excluding setup and teardown. */
  windowMs: number
  vusMax: number
  pool: number
  seedDays: number
  thinkScale: number
  iterations: number
  /** Journey traffic only; seeding and clean-up are not counted. */
  requests: { count: number; rps: number }
  errorRate: number | null
  checksRate: number | null
  latency: Stats | null
  groups: Record<string, GroupStats>
  endpoints: Record<string, { op: Op; p95: number | null; budgetP95: number | null; ok: boolean | null }>
  fnTtfb: { p95: number | null; budget: number }
  journeys: Record<string, { count: number; p95Ms: number | null }>
  phases: { firstP95: number | null; lastP95: number | null; drift: number | null; driftMax: number }
  thresholds: ThresholdResult[]
  thresholdsPassed: number
  thresholdsFailed: number
  /** Every enforced threshold held. */
  budgetsMet: boolean
}

// k6 reports a sub-metric that got no samples with all-zero values; a real
// request never takes 0 ms, so that reads as "no data" here.
const hasSamples = (m: Metric | undefined): m is Metric => !!m && m.type === 'trend' && (m.values.max > 0 || m.values.avg > 0)
const stats = (m: Metric | undefined): Stats | null =>
  hasSamples(m)
    ? { avg: m.values.avg, med: m.values.med, p90: m.values['p(90)'], p95: m.values['p(95)'], p99: m.values['p(99)'], max: m.values.max }
    : null
const rate = (m: Metric | undefined): number | null => (m && typeof m.values.rate === 'number' ? m.values.rate : null)
const count = (m: Metric | undefined): number => (m && typeof m.values.count === 'number' ? m.values.count : 0)
const p95 = (m: Metric | undefined): number | null => (hasSamples(m) ? m.values['p(95)'] : null)

// Thresholds like `p(95)>=0` exist only to surface a sub-metric in the summary.
const isSurfacing = (expr: string) => />=0$/.test(expr)

export function buildHeadline(data: SummaryData, profile: Profile, journeyNames: string[]): Headline {
  const m = data.metrics
  const finished = new Date()
  const lax = __ENV.PERF_LAX === '1'

  const thresholds: ThresholdResult[] = []
  for (const [metric, metricData] of Object.entries(m)) {
    for (const [expr, result] of Object.entries(metricData.thresholds ?? {})) {
      if (!isSurfacing(expr)) thresholds.push({ metric, expr, ok: result.ok })
    }
  }
  thresholds.sort((a, b) => Number(a.ok) - Number(b.ok) || a.metric.localeCompare(b.metric))
  const failed = thresholds.filter((t) => !t.ok).length

  const groups: Record<string, GroupStats> = {}
  for (const op of ['search', 'read', 'write', 'auth', 'fn', 'signin'] as Op[]) {
    const budget = op in LATENCY ? LATENCY[op as keyof typeof LATENCY] : null
    groups[op] = {
      latency: stats(m[`http_req_duration{op:${op}}`]),
      count: count(m[`http_reqs{op:${op}}`]),
      errorRate: rate(m[`http_req_failed{op:${op}}`]),
      budget: budget ? { p95: budget.p95, p99: budget.p99 } : null,
    }
  }

  const endpoints: Headline['endpoints'] = {}
  for (const [name, op] of Object.entries(ENDPOINTS)) {
    const metric = m[`http_req_duration{name:${name}}`]
    const budgetP95 = op in LATENCY ? LATENCY[op as keyof typeof LATENCY].p95 : null
    const threshold = metric?.thresholds ? Object.values(metric.thresholds)[0] : undefined
    const measured = p95(metric)
    endpoints[name] = { op, p95: measured, budgetP95, ok: measured != null && threshold ? threshold.ok : null }
  }

  const journeys: Headline['journeys'] = {}
  for (const name of journeyNames) {
    journeys[name] = { count: count(m[`journeys{journey:${name}}`]), p95Ms: p95(m[`journey_duration{journey:${name}}`]) }
  }

  const firstP95 = p95(m['http_req_duration{scope:journey,phase:first}'])
  const lastP95 = p95(m['http_req_duration{scope:journey,phase:last}'])
  const requests = count(m['http_reqs{scope:journey}'])
  const windowMs = Math.min(profile.totalMs, data.state.testRunDurationMs)

  return {
    schema: 1,
    scenario: profile.name,
    reportOnly: profile.reportOnly,
    lax,
    git: { sha: __ENV.PERF_GIT_SHA || 'local', branch: __ENV.PERF_GIT_BRANCH || 'local' },
    startedAt: new Date(finished.getTime() - data.state.testRunDurationMs).toISOString(),
    finishedAt: finished.toISOString(),
    k6RunMs: data.state.testRunDurationMs,
    windowMs: profile.totalMs,
    vusMax: profile.peakVus,
    pool: profile.pool,
    seedDays: profile.seedDays,
    thinkScale: profile.thinkScale,
    iterations: count(m.iterations),
    requests: { count: requests, rps: windowMs > 0 ? Math.round((requests / (windowMs / 1000)) * 10) / 10 : 0 },
    errorRate: rate(m['http_req_failed{scope:journey}']),
    checksRate: rate(m['checks{scope:journey}']),
    latency: stats(m['http_req_duration{scope:journey}']),
    groups,
    endpoints,
    fnTtfb: { p95: p95(m['http_req_waiting{op:fn}']), budget: FN_TTFB.p95 },
    journeys,
    phases: { firstP95, lastP95, drift: firstP95 && lastP95 ? Math.round((lastP95 / firstP95) * 100) / 100 : null, driftMax: SOAK_DRIFT_MAX },
    thresholds,
    thresholdsPassed: thresholds.length - failed,
    thresholdsFailed: failed,
    budgetsMet: failed === 0,
  }
}

const ms = (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`)
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const pad = (s: string, n: number) => s.padEnd(n)
const num = (s: string, n: number) => s.padStart(n)

export function textSummary(h: Headline): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`  FitLog perf · ${h.scenario}${h.reportOnly ? ' (report-only)' : ''}${h.lax ? ' (lax budgets)' : ''} · ${h.vusMax} VUs peak · ${Math.round(h.windowMs / 1000)}s window · ${h.pool} users × ${h.seedDays} days`)
  lines.push(`  requests ${h.requests.count} (${h.requests.rps}/s) · iterations ${h.iterations} · errors ${pct(h.errorRate)} · checks ${pct(h.checksRate)}`)
  if (h.latency) lines.push(`  latency  med ${ms(h.latency.med)} · p90 ${ms(h.latency.p90)} · p95 ${ms(h.latency.p95)} · p99 ${ms(h.latency.p99)} · max ${ms(h.latency.max)}`)
  lines.push('')
  lines.push(`  ${pad('group', 9)}${num('p95', 9)}${num('p99', 9)}${num('errors', 9)}${num('n', 8)}   budget p95/p99`)
  for (const [op, g] of Object.entries(h.groups)) {
    if (!g.count && !g.latency) continue
    lines.push(`  ${pad(op, 9)}${num(ms(g.latency?.p95), 9)}${num(ms(g.latency?.p99), 9)}${num(pct(g.errorRate), 9)}${num(String(g.count), 8)}   ${g.budget ? `${g.budget.p95}/${g.budget.p99} ms` : op === 'fn' ? `ttfb p95 ${ms(h.fnTtfb.p95)} / ${h.fnTtfb.budget} ms` : 'not budgeted'}`)
  }
  const slow = Object.entries(h.endpoints)
    .filter(([, e]) => e.p95 != null)
    .sort((a, b) => (b[1].p95 ?? 0) - (a[1].p95 ?? 0))
    .slice(0, 8)
  if (slow.length) {
    lines.push('')
    lines.push('  slowest endpoints (p95)')
    for (const [name, e] of slow) lines.push(`    ${pad(name, 20)}${num(ms(e.p95), 9)}   ${e.ok === false ? '✗ over' : e.ok ? '✓ within' : '·'} ${e.budgetP95 != null ? `${e.budgetP95} ms` : ''}`)
  }
  const journeys = Object.entries(h.journeys).filter(([, j]) => j.count)
  if (journeys.length) {
    lines.push('')
    lines.push(`  journeys  ${journeys.map(([name, j]) => `${name} ${j.count}× (p95 ${ms(j.p95Ms)})`).join(' · ')}`)
  }
  if (h.phases.drift != null) lines.push(`  drift     last-third p95 ${ms(h.phases.lastP95)} / first-third ${ms(h.phases.firstP95)} = ${h.phases.drift}× (soak limit ${h.phases.driftMax}×)`)
  lines.push('')
  lines.push(`  thresholds: ${h.thresholdsPassed} passed, ${h.thresholdsFailed} failed`)
  for (const t of h.thresholds.filter((t) => !t.ok)) lines.push(`    ✗ ${t.metric}  ${t.expr}`)
  lines.push('')
  return lines.join('\n')
}
