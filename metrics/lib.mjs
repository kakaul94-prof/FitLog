// Pure helpers shared by the metrics scripts (no file or network access here,
// so they're unit-tested directly in metrics.test.mjs).

export const HISTORY_CAP = 200

export function countStatuses(tests) {
  const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0 }
  for (const t of tests) totals[t.status] = (totals[t.status] ?? 0) + 1
  return totals
}

/** `${{ toJSON(needs) }}` from the workflow → { unit: 'success', e2e: 'failure' }. */
export function parseJobResults(json) {
  try {
    return Object.fromEntries(Object.entries(JSON.parse(json || '{}')).map(([job, v]) => [job, v.result]))
  } catch {
    return {}
  }
}

/**
 * One history record per CI run. Holds only test names, statuses, durations and
 * public run identifiers — never error text, logs or environment values, so
 * nothing secret can end up on the public dashboard.
 */
export function buildRun({ env, sources, jobs = {}, now = new Date() }) {
  const repo = env.GITHUB_REPOSITORY ?? 'local'
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
  return {
    id: `${env.GITHUB_RUN_ID ?? 'local'}-${env.GITHUB_RUN_ATTEMPT ?? '1'}`,
    timestamp: now.toISOString(),
    repo,
    sha: env.GITHUB_SHA ?? 'local',
    branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || 'local',
    event: env.GITHUB_EVENT_NAME ?? 'local',
    runUrl: env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    jobs,
    sources,
  }
}

/** Append a run (replacing a re-run of the same attempt id) and keep the newest `cap`. */
export function appendRun(history, run, cap = HISTORY_CAP) {
  const runs = (history?.runs ?? []).filter((r) => r.id !== run.id)
  runs.push(run)
  return { version: 1, updated: run.timestamp, runs: runs.slice(-cap) }
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function runStatus(run) {
  const sources = Object.values(run.sources).filter((s) => s.kind === 'tests')
  if (sources.some((s) => s.totals.failed > 0)) return 'failed'
  if (Object.values(run.jobs).some((r) => r !== 'success')) return 'failed'
  if (sources.some((s) => s.totals.flaky > 0)) return 'flaky'
  return 'passed'
}

const ICON = { passed: '✅', flaky: '⚠️', failed: '❌' }
const LABEL = { e2e: 'E2E', unit: 'Unit' }
const md = (s) => String(s).replaceAll('|', '\\|')

/** Markdown for the GitHub Actions job summary (shown on every run, PRs included). */
export function summaryMarkdown(run, { expected = [] } = {}) {
  const status = runStatus(run)
  const out = [`### ${ICON[status]} Test quality: \`${run.sha.slice(0, 7)}\` on \`${run.branch}\``, '']
  out.push('| Suite | Passed | Failed | Flaky | Skipped | Duration |', '|---|--:|--:|--:|--:|--:|')
  for (const [key, s] of Object.entries(run.sources)) {
    const t = s.totals
    out.push(`| ${LABEL[key] ?? key} (${s.tool}) | ${t.passed} | ${t.failed} | ${t.flaky} | ${t.skipped} | ${formatDuration(s.durationMs)} |`)
  }
  for (const key of expected.filter((k) => !run.sources[k])) {
    out.push(`| ${LABEL[key] ?? key} | — | — | — | — | no report (job: ${run.jobs[key] ?? 'unknown'}) |`)
  }

  const all = Object.entries(run.sources).flatMap(([key, s]) => s.tests.map((t) => ({ ...t, suite: LABEL[key] ?? key })))
  const flaky = all.filter((t) => t.status === 'flaky')
  if (flaky.length) {
    out.push('', '**Flaky** (failed, then passed on retry):', '')
    for (const t of flaky) out.push(`- \`${t.file}\` › ${md(t.name)} (${t.attempts} attempts)`)
  }
  const failed = all.filter((t) => t.status === 'failed')
  if (failed.length) {
    out.push('', '**Failed:**', '')
    for (const t of failed) out.push(`- \`${t.file}\` › ${md(t.name)}`)
  }

  out.push('', '<details><summary>Slowest 5 tests</summary>', '', '| Test | Suite | Duration |', '|---|---|--:|')
  for (const t of [...all].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)) {
    out.push(`| \`${t.file}\` › ${md(t.name)} | ${t.suite} | ${formatDuration(t.durationMs)} |`)
  }
  out.push('', '</details>', '')
  return out.join('\n')
}

/** Flake hunt: group the N repeats of each test (retries off) and rank by failures. */
export function aggregateRepeats(tests) {
  const byTest = new Map()
  for (const t of tests) {
    if (t.status === 'skipped') continue
    const key = `${t.project} › ${t.file} › ${t.name}`
    const g = byTest.get(key) ?? { name: t.name, file: t.file, project: t.project, runs: 0, failures: 0, durations: [] }
    g.runs++
    if (t.status !== 'passed') g.failures++
    g.durations.push(t.durationMs)
    byTest.set(key, g)
  }
  return [...byTest.values()]
    .map(({ durations, ...g }) => {
      durations.sort((a, b) => a - b)
      return { ...g, failRate: g.failures / g.runs, medianMs: durations[Math.floor(durations.length / 2)], maxMs: durations.at(-1) }
    })
    .sort((a, b) => b.failures - a.failures || b.maxMs - a.maxMs)
}

export function flakeHuntMarkdown(tests) {
  const rows = aggregateRepeats(tests)
  const total = rows.reduce((n, r) => n + r.runs, 0)
  const repeat = Math.max(0, ...rows.map((r) => r.runs))
  const flaky = rows.filter((r) => r.failures > 0)
  const out = [
    `### 🔎 Flake hunt: ${rows.length} tests × ${repeat} runs, retries off`,
    '',
    flaky.length
      ? `**${flaky.length} of ${rows.length} tests failed at least once** across ${total} runs.`
      : `**No failures in ${total} runs.** Every test passed all ${repeat} times.`,
    '',
    'A wide gap between median and max time points at a timing-sensitive test, even if it never failed.',
    '',
    '| Test | Project | Runs | Failed | Fail rate | Median | Max |',
    '|---|---|--:|--:|--:|--:|--:|',
  ]
  for (const r of rows) {
    const rate = `${(r.failRate * 100).toFixed(r.failRate && r.failRate < 0.1 ? 1 : 0)}%`
    out.push(`| \`${r.file}\` › ${md(r.name)} | ${r.project} | ${r.runs} | ${r.failures} | ${rate} | ${formatDuration(r.medianMs)} | ${formatDuration(r.maxMs)} |`)
  }
  return out.join('\n') + '\n'
}
