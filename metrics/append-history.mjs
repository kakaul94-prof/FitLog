// Appends one run record to the history file, keeping the newest 200 runs.
//
//   node metrics/append-history.mjs <run.json> <history.json>
import fs from 'node:fs'
import { appendRun } from './lib.mjs'

const [runPath, historyPath] = process.argv.slice(2)
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : null
const next = appendRun(history, run)
fs.writeFileSync(historyPath, JSON.stringify(next))
console.log(`metrics: ${next.runs.length} runs in ${historyPath}`)
