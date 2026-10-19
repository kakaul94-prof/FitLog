// Appends one perf run record to the performance history, keeping the newest 200.
//
//   node metrics/append-perf.mjs <run.json> <perf.json>
import fs from 'node:fs'
import { appendPerfRun } from './perf.mjs'

const [runPath, historyPath] = process.argv.slice(2)
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : null
const next = appendPerfRun(history, run)
fs.writeFileSync(historyPath, JSON.stringify(next))
console.log(`perf: ${next.runs.length} runs in ${historyPath}`)
