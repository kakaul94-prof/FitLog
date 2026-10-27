// Appends one canary run to the dashboard's history (data/app-canary.json on
// gh-pages), newest last, keeping the newest MAX runs: at a run every 30
// minutes that is about six weeks. A re-run of the same workflow run replaces
// its earlier record rather than counting twice.
//
//   node canary/append.mjs <summary.json> <app-canary.json> [--alerts alerts.json]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX = 2000

export function appendRun(history, run, max = MAX) {
  const runs = Array.isArray(history) ? history.filter((r) => !(run.run_id && r.run_id === run.run_id)) : []
  runs.push(run)
  runs.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
  return runs.slice(-max)
}

function main(argv) {
  const [summaryPath, historyPath, ...rest] = argv
  if (!summaryPath || !historyPath) {
    console.error('usage: node canary/append.mjs <summary.json> <app-canary.json> [--alerts alerts.json]')
    return 2
  }
  const run = JSON.parse(readFileSync(summaryPath, 'utf8'))
  const alertsIdx = rest.indexOf('--alerts')
  const alertsPath = alertsIdx >= 0 ? rest[alertsIdx + 1] : undefined
  if (alertsPath && existsSync(alertsPath)) {
    const { action, issue, url } = JSON.parse(readFileSync(alertsPath, 'utf8'))
    run.alert = { action, issue, url }
  }
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : []
  const next = appendRun(history, run)
  mkdirSync(dirname(historyPath), { recursive: true })
  writeFileSync(historyPath, JSON.stringify(next))
  console.log(`app-canary: ${next.length} runs in ${historyPath}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)))
