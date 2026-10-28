// Summarises the Maestro JUnit reports from .maestro/ci/run.sh: one row per
// flow with its passes across runs, its median time and its first failure.
// Appends to the GitHub job summary when there is one, else prints.
//
//   node .maestro/ci/summary.mjs [reports/android]
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'reports/android'
const runs = existsSync(dir)
  ? readdirSync(dir)
      .filter((d) => /^run-\d+$/.test(d) && existsSync(join(dir, d, 'report.xml')))
      .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  : []

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** flow name -> { passes, times: number[], failures: string[] } */
const flows = new Map()
for (const run of runs) {
  const xml = readFileSync(join(dir, run, 'report.xml'), 'utf8')
  // A testcase is either self-closing or wraps a <failure>/<error> element.
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const [, attrs, , body = ''] = m
    const name = attr(attrs, 'name') ?? '?'
    const failed = attr(attrs, 'status') ? attr(attrs, 'status') !== 'SUCCESS' : /<(failure|error)\b/.test(body)
    const entry = flows.get(name) ?? { passes: 0, times: [], failures: [] }
    if (!failed) entry.passes += 1
    else {
      const message = body.match(/<(?:failure|error)\b[^>]*?message="([^"]*)"/)?.[1] ?? body.replace(/<[^>]+>/g, ' ')
      entry.failures.push(`${run}: ${unescape(message).replace(/\s+/g, ' ').trim().slice(0, 160)}`)
    }
    entry.times.push(Number(attr(attrs, 'time') ?? 0))
    flows.set(name, entry)
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0
}

const lines = [`## Android UI tests (Maestro)`, '']
if (!runs.length) {
  lines.push('No Maestro report was written: the emulator or the build failed before the flows ran. See the job log.')
} else {
  const total = [...flows.values()].reduce((n, f) => n + f.times.length, 0)
  const passed = [...flows.values()].reduce((n, f) => n + f.passes, 0)
  const flaky = [...flows.entries()].filter(([, f]) => f.passes > 0 && f.passes < f.times.length)
  lines.push(
    `${runs.length} run${runs.length === 1 ? '' : 's'} of the flow set, retries off: **${passed} of ${total}** flow runs passed` +
      (flaky.length ? `, ${flaky.length} flow${flaky.length === 1 ? '' : 's'} flaky.` : '.'),
    '',
    '| Flow | Passed | Median time | First failure |',
    '|---|---|---|---|',
  )
  for (const [name, f] of [...flows.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${name} | ${f.passes}/${f.times.length} | ${median(f.times).toFixed(0)} s | ${f.failures[0] ?? ''} |`)
  }
}

const text = lines.join('\n') + '\n'
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
process.stdout.write(text)
