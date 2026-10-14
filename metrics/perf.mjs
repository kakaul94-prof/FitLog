// Performance runs for the quality dashboard (pure helpers; the file and
// environment access is in perf-summary.mjs and append-perf.mjs).
//
// A perf run writes reports/perf/<scenario>/headline.json (perf-tests/lib/summary.ts,
// with the verdict added by perf-tests/scripts/check-run.mjs). One CI run may
// hold several scenarios (the nightly runs load + soak), so one history record
// carries a `scenarios` map. Like metrics/lib.mjs, the record keeps numbers
// and names only: no environment values, no bodies, nothing secret.

export const PERF_HISTORY_CAP = 200

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const latency = (s) => (s ? { avg: num(s.avg), p50: num(s.med), p90: num(s.p90), p95: num(s.p95), p99: num(s.p99), max: num(s.max) } : null)

/** The slice of a headline the dashboard keeps. */
export function slimHeadline(h) {
  const verdict = h.verdict ?? { passed: h.budgetsMet, enforced: !h.reportOnly, reasons: [] }
  const groups = {}
  for (const [op, g] of Object.entries(h.groups ?? {})) {
    if (!g.count && !g.latency) continue
    groups[op] = { p95: num(g.latency?.p95), p99: num(g.latency?.p99), errorRate: num(g.errorRate), count: g.count ?? 0, budget: g.budget ?? null }
  }
  const endpoints = {}
  for (const [name, e] of Object.entries(h.endpoints ?? {})) {
    if (e.p95 == null) continue
    endpoints[name] = { op: e.op, p95: num(e.p95), budgetP95: num(e.budgetP95), ok: e.ok ?? null }
  }
  return {
    scenario: h.scenario,
    passed: Boolean(verdict.passed),
    enforced: Boolean(verdict.enforced),
    reasons: verdict.reasons ?? [],
    lax: Boolean(h.lax),
    vusMax: h.vusMax,
    pool: h.pool,
    seedDays: h.seedDays,
    windowMs: h.windowMs,
    k6RunMs: h.k6RunMs,
    requests: { count: h.requests?.count ?? 0, rps: num(h.requests?.rps) },
    iterations: h.iterations ?? 0,
    errorRate: num(h.errorRate),
    checksRate: num(h.checksRate),
    latency: latency(h.latency),
    groups,
    endpoints,
    fnTtfb: h.fnTtfb ? { p95: num(h.fnTtfb.p95), budget: h.fnTtfb.budget } : null,
    journeys: h.journeys ?? {},
    phases: h.phases ? { firstP95: num(h.phases.firstP95), lastP95: num(h.phases.lastP95), drift: num(h.phases.drift), driftMax: h.phases.driftMax, driftMinMs: h.phases.driftMinMs ?? null } : null,
    thresholds: { total: (h.thresholds ?? []).length, failed: (h.thresholds ?? []).filter((t) => !t.ok).map((t) => `${t.metric} ${t.expr}`) },
  }
}

/** One history record per CI run, from the headlines of its scenarios. */
export function buildPerfRun({ env, headlines, now = new Date() }) {
  const repo = env.GITHUB_REPOSITORY ?? 'local'
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
  const scenarios = {}
  for (const h of headlines) scenarios[h.scenario] = slimHeadline(h)
  return {
    id: `${env.GITHUB_RUN_ID ?? 'local'}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`,
    timestamp: now.toISOString(),
    repo,
    sha: env.GITHUB_SHA ?? headlines[0]?.git?.sha ?? 'local',
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || headlines[0]?.git?.branch || 'local',
    event: env.GITHUB_EVENT_NAME ?? 'local',
    runUrl: env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    scenarios,
  }
}

/** Append a run (replacing a re-run of the same attempt id) and keep the newest `cap`. */
export function appendPerfRun(history, run, cap = PERF_HISTORY_CAP) {
  const runs = (history?.runs ?? []).filter((r) => r.id !== run.id)
  runs.push(run)
  return { version: 1, updated: run.timestamp, runs: runs.slice(-cap) }
}

export const fmtMs = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`)
export const fmtPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const md = (s) => String(s).replaceAll('|', '\\|')

/** Markdown for the GitHub Actions job summary. */
export function perfMarkdown(run) {
  const scenarios = Object.values(run.scenarios)
  const allPassed = scenarios.every((s) => s.passed)
  const out = [`### ${allPassed ? '✅' : '❌'} Performance: \`${run.sha.slice(0, 7)}\` on \`${run.branch}\``, '']
  if (!scenarios.length) {
    out.push('No perf headlines found.', '')
    return out.join('\n')
  }
  out.push('| Scenario | Verdict | VUs | req/s | p50 | p95 | p99 | Errors | Thresholds |', '|---|---|--:|--:|--:|--:|--:|--:|--:|')
  for (const s of scenarios) {
    const verdict = s.passed ? (s.enforced ? '✅ passed' : s.reasons.length ? '📊 report-only' : '✅ passed') : '❌ failed'
    out.push(
      `| ${s.scenario}${s.lax ? ' (lax)' : ''} | ${verdict} | ${s.vusMax} | ${s.requests.rps ?? '—'} | ${fmtMs(s.latency?.p50)} | ${fmtMs(s.latency?.p95)} | ${fmtMs(s.latency?.p99)} | ${fmtPct(s.errorRate)} | ${s.thresholds.total - s.thresholds.failed.length}/${s.thresholds.total} |`,
    )
  }
  for (const s of scenarios) {
    out.push('', `<details><summary>${s.scenario}: by endpoint group</summary>`, '', '| Group | p95 | p99 | Budget p95/p99 | Errors | Requests |', '|---|--:|--:|--:|--:|--:|')
    for (const [op, g] of Object.entries(s.groups)) {
      out.push(`| ${op} | ${fmtMs(g.p95)} | ${fmtMs(g.p99)} | ${g.budget ? `${g.budget.p95} / ${g.budget.p99} ms` : '—'} | ${fmtPct(g.errorRate)} | ${g.count} |`)
    }
    if (s.phases?.drift != null) out.push('', `Drift: last-third p95 ${fmtMs(s.phases.lastP95)} vs first-third ${fmtMs(s.phases.firstP95)} = **${s.phases.drift}×** (limit ${s.phases.driftMax}×)`)
    if (s.reasons.length) {
      out.push('', '**Notes:**', '')
      for (const r of s.reasons) out.push(`- ${md(r)}`)
    }
    out.push('', '</details>')
  }
  out.push('')
  return out.join('\n')
}
