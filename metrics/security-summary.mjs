// Summarizes the security scan reports for the CI job summary (or the terminal).
//
//   node metrics/security-summary.mjs [reportsDir]     (default: reports/security)
//
// Reads whichever reports exist; a missing one is listed as "did not run".
import fs from 'node:fs'
import path from 'node:path'
import { readGitleaks, readNpmAudit, readPipAudit, readZap, securityMarkdown } from './security.mjs'

const READERS = {
  'gitleaks.json': readGitleaks,
  'npm-audit.json': readNpmAudit,
  'pip-audit.json': readPipAudit,
  'zap.json': readZap,
}

const dir = process.argv[2] ?? 'reports/security'
const results = {}
for (const [file, read] of Object.entries(READERS)) {
  const p = path.join(dir, file)
  try {
    results[file] = read(JSON.parse(fs.readFileSync(p, 'utf8')))
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`security: could not read ${p}: ${err.message}`)
    results[file] = null
  }
}

const summary = securityMarkdown(results)
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
console.log(summary)
