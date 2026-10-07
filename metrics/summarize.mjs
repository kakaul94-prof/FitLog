// Turns this CI run's test reports into one history record + a job summary.
//
//   node metrics/summarize.mjs [reportsDir]      (default: reports/)
//
// Reads whichever reports exist, writes <reportsDir>/run.json, and appends a
// Markdown summary to $GITHUB_STEP_SUMMARY (or prints it when run locally).
import fs from 'node:fs'
import path from 'node:path'
import { fromPlaywright } from './adapters/playwright.mjs'
import { fromVitest } from './adapters/vitest.mjs'
import { buildRun, parseJobResults, summaryMarkdown } from './lib.mjs'

// Every metric source the pipeline produces. To add one (axe, Lighthouse, k6…),
// write an adapter that returns a source block and register it here; the
// dashboard picks it up by its `kind`.
const SOURCES = [
  { key: 'e2e', file: 'playwright.json', adapt: (r) => fromPlaywright(r) },
  { key: 'unit', file: 'vitest.json', adapt: (r) => fromVitest(r) },
]

const dir = process.argv[2] ?? 'reports'
const sources = {}
for (const { key, file, adapt } of SOURCES) {
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) {
    console.warn(`metrics: no ${p}, skipping ${key}`)
    continue
  }
  try {
    sources[key] = adapt(JSON.parse(fs.readFileSync(p, 'utf8')))
  } catch (err) {
    console.warn(`metrics: could not read ${p}: ${err.message}`)
  }
}

const run = buildRun({ env: process.env, sources, jobs: parseJobResults(process.env.JOB_RESULTS) })
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run))

const summary = summaryMarkdown(run, { expected: SOURCES.map((s) => s.key) })
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
else console.log(summary)
