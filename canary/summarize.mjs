// Turns a canary run's Playwright JSON report into one record: the run's
// status, how long each step took, which one failed and why. That record is
// what the alert step reads, what the dashboard charts (data/app-canary.json on
// gh-pages) and what the job summary shows.
//
//   node canary/summarize.mjs reports/app-canary/playwright.json reports/app-canary/summary.json
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { envSecrets, firstLine, redact } from './redact.mjs'
import { STEPS } from './steps.mjs'

export const SCHEMA = 1

/** Every test in the report, however the suites nest. */
export function collectTests(report) {
  const out = []
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) out.push({ title: spec.title, ...t })
    for (const s of suite.suites ?? []) walk(s)
  }
  for (const s of report?.suites ?? []) walk(s)
  return out
}

const annotation = (test, type) => test?.annotations?.find((a) => a.type === type)?.description

/**
 * @param {object|null} report  the Playwright JSON report, or null when the run never produced one
 * @param {object} meta  run_id, run_url, trigger, timestamp, site, trainer, drill (annotations in the report win)
 */
export function summarize(report, meta = {}) {
  const secrets = meta.secrets ?? []
  const test = collectTests(report)[0]
  const results = test?.results ?? []
  const last = results.at(-1)
  const passed = last?.status === 'passed'
  const status = !last ? 'fail' : passed ? (results.length > 1 ? 'flaky' : 'pass') : 'fail'
  const trainer = meta.trainer ?? annotation(test, 'trainer') !== 'false'
  const drill = annotation(test, 'drill') ?? meta.drill ?? 'none'

  const steps = STEPS.map((name) => {
    const step = last?.steps?.find((s) => s.title === name)
    if (!step) return { name, status: name === STEPS[4] && !trainer ? 'off' : 'skipped', duration_ms: null }
    const error = step.error?.message
    return error
      ? { name, status: 'fail', duration_ms: step.duration, error: firstLine(redact(error, secrets)) }
      : { name, status: 'pass', duration_ms: step.duration }
  })
  const failing = steps.find((s) => s.status === 'fail')
  let error = failing?.error ?? null
  if (!error && status === 'fail') {
    const raw = last?.errors?.[0]?.message ?? last?.error?.message
    error = raw
      ? firstLine(redact(raw, secrets))
      : last
        ? `the run ended with status "${last.status}"`
        : 'the canary produced no report: it did not start (see the run log)'
  }

  return {
    schema: SCHEMA,
    timestamp: meta.timestamp ?? new Date().toISOString(),
    run_id: meta.run_id ?? null,
    run_url: meta.run_url ?? null,
    trigger: meta.trigger ?? 'local',
    site: annotation(test, 'site') ?? meta.site ?? null,
    trainer,
    drill: drill === 'none' ? null : drill,
    status,
    attempts: results.length,
    duration_ms: last?.duration ?? null,
    steps,
    failing_step: failing?.name ?? null,
    error,
  }
}

const mark = { pass: '✅', fail: '❌', skipped: '⏭️', off: '➖' }

/** Markdown for the GitHub job summary and the alert issue. */
export function stepsTable(summary) {
  const rows = summary.steps.map((s) => `| ${mark[s.status]} ${s.name} | ${s.status} | ${s.duration_ms == null ? '—' : `${(s.duration_ms / 1000).toFixed(1)} s`} | ${s.error ? `\`${s.error.replace(/`/g, "'")}\`` : ''} |`)
  return ['| Step | Result | Took | Error |', '|---|---|---|---|', ...rows].join('\n')
}

export function headline(summary) {
  const verdict = summary.status === 'pass' ? 'passed' : summary.status === 'flaky' ? 'passed on the retry (flaky)' : `failed at **${summary.failing_step ?? 'the run'}**`
  const drill = summary.drill ? ` · drill: ${summary.drill}` : ''
  return `Production app canary ${verdict} on ${summary.site ?? 'the site'} (${summary.trigger}${drill})`
}

/** Meta from a GitHub Actions environment (or a local shell). */
export function metaFromEnv(env = process.env) {
  const runId = env.GITHUB_RUN_ID
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com'
  return {
    run_id: runId ?? null,
    run_url: runId && env.GITHUB_REPOSITORY ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}` : null,
    trigger: env.TRIGGER || 'local',
    site: env.CANARY_SITE_URL || undefined,
    trainer: env.CANARY_TRAINER == null || env.CANARY_TRAINER === '' ? undefined : !/^(false|0|no|off)$/i.test(env.CANARY_TRAINER),
    drill: env.CANARY_DRILL || undefined,
    secrets: envSecrets(env),
  }
}

function main(argv) {
  const [reportPath, outPath] = argv
  if (!reportPath || !outPath) {
    console.error('usage: node canary/summarize.mjs <playwright.json> <summary.json>')
    return 2
  }
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
  const summary = summarize(report, metaFromEnv())
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  const text = `### ${headline(summary)}\n\n${stepsTable(summary)}\n${summary.error && !summary.failing_step ? `\n${summary.error}\n` : ''}`
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
  console.log(text)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
