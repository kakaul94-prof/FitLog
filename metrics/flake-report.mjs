// Report for the manual "Flake hunt" workflow: the E2E suite was run N times
// with retries OFF, so every failure counts. Groups the repeats per test and
// ranks them by how often they failed.
//
//   node metrics/flake-report.mjs [reports/playwright.json]
import fs from 'node:fs'
import { playwrightTests } from './adapters/playwright.mjs'
import { flakeHuntMarkdown } from './lib.mjs'

const file = process.argv[2] ?? 'reports/playwright.json'
const summary = flakeHuntMarkdown(playwrightTests(JSON.parse(fs.readFileSync(file, 'utf8'))))
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
else console.log(summary)
