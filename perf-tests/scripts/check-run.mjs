#!/usr/bin/env node
// The verdict on a finished run, from its headline.json and k6's exit code.
//
//   node perf-tests/scripts/check-run.mjs <reports/perf/scenario> <k6 exit code>
//
// Exits 0 when the run passed, 1 when it failed. In a report-only scenario
// (stress, spike) a breached budget is the expected result and does not fail
// the run; a crash or a timeout still does. The verdict is written back into
// headline.json so the dashboard shows the same answer.
import fs from 'node:fs'
import path from 'node:path'

const K6_EXIT = {
  0: 'ok',
  99: 'thresholds breached',
  100: 'setup() timed out',
  101: 'teardown() timed out',
  102: 'timed out',
  103: 'k6 engine error',
  104: 'invalid configuration',
  105: 'interrupted (Ctrl-C)',
  107: 'script exception',
  108: 'aborted by the script',
}

const [dir, codeArg] = process.argv.slice(2)
if (!dir) {
  console.error('usage: check-run.mjs <reports dir> <k6 exit code>')
  process.exit(2)
}
const code = Number(codeArg ?? 0)
const file = path.join(dir, 'headline.json')

function fail(message) {
  console.error(`perf: FAILED — ${message}`)
  process.exit(1)
}

if (!fs.existsSync(file)) {
  fail(code === 0 ? 'the run produced no headline.json' : `k6 exited with ${code} (${K6_EXIT[code] ?? 'unknown'}) before writing a summary; see the log above`)
}
const h = JSON.parse(fs.readFileSync(file, 'utf8'))

const budgets = []
const errors = []
if (code !== 0 && code !== 99) {
  // The run didn't complete: its numbers describe nothing, so that is the whole verdict.
  errors.push(`k6 exited with ${code} (${K6_EXIT[code] ?? 'unknown'}); see the log above`)
} else {
  if (h.thresholdsFailed > 0) {
    budgets.push(`${h.thresholdsFailed} threshold(s) breached: ${h.thresholds.filter((t) => !t.ok).map((t) => `${t.metric} ${t.expr}`).join('; ')}`)
  }
  // Drift: a ratio AND an absolute rise, so a few milliseconds of noise between
  // thirds can't fail a run (config/thresholds.ts explains the numbers).
  const { drift, driftMax, firstP95, lastP95, driftMinMs = 0 } = h.phases
  if (h.scenario === 'soak' && drift != null && drift > driftMax && lastP95 - firstP95 >= driftMinMs) {
    budgets.push(`latency drifted: last-third p95 ${Math.round(lastP95)} ms is ${drift}× the first third's ${Math.round(firstP95)} ms (limit ${driftMax}× and +${driftMinMs} ms)`)
  }
  if (h.k6RunMs < h.windowMs * 0.9) {
    budgets.push(`the run ended early, after ${Math.round(h.k6RunMs / 1000)} s of a ${Math.round(h.windowMs / 1000)} s window (aborted by the error-rate guard?)`)
  }
  if (code === 99 && budgets.length === 0) errors.push('k6 reported breached thresholds that the summary does not show')
}

const passed = errors.length === 0 && (budgets.length === 0 || h.reportOnly)
h.verdict = { passed, enforced: !h.reportOnly, reasons: [...errors, ...budgets] }
fs.writeFileSync(file, JSON.stringify(h, null, 2))

const where = `${path.join(dir, 'report.html')} (HTML), ${file}`
if (passed) {
  if (budgets.length) console.log(`perf: ${h.scenario} finished (report-only): ${budgets.join(' · ')}\nperf: reports: ${where}`)
  else console.log(`perf: ${h.scenario} passed — ${h.thresholdsPassed} thresholds held\nperf: reports: ${where}`)
  process.exit(0)
}
fail(`${h.scenario}: ${[...errors, ...budgets].join(' · ')}\nperf: reports: ${where}`)
