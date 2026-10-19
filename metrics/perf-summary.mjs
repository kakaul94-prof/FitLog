// Turns the perf headlines of this run into one history record + a job summary.
//
//   node metrics/perf-summary.mjs [reportsDir]      (default: reports/perf)
//
// Reads <reportsDir>/*/headline.json (one per scenario), writes
// <reportsDir>/run.json, and appends Markdown to $GITHUB_STEP_SUMMARY (or
// prints it when run locally).
import fs from 'node:fs'
import path from 'node:path'
import { buildPerfRun, perfMarkdown } from './perf.mjs'

const dir = process.argv[2] ?? 'reports/perf'
const headlines = []
if (fs.existsSync(dir)) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(dir, entry.name, 'headline.json')
    if (!fs.existsSync(file)) continue
    try {
      headlines.push(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (err) {
      console.warn(`perf: could not read ${file}: ${err.message}`)
    }
  }
}
headlines.sort((a, b) => a.scenario.localeCompare(b.scenario))
if (!headlines.length) console.warn(`perf: no headline.json under ${dir}`)

const run = buildPerfRun({ env: process.env, headlines })
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run))

const summary = perfMarkdown(run)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
else console.log(summary)
