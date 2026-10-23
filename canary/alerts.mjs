// Alerts for the production app canary: one GitHub issue per outage.
//
// A failing run opens an issue labelled prod-app-canary (and the label, if it
// doesn't exist). While the canary keeps failing, each run comments on that
// same issue instead of opening another, so one outage is one issue however
// long it lasts. The first run that passes comments and closes it. Issues the
// canary didn't open (no marker) are never touched, even with the label.
//
//   node canary/alerts.mjs reports/app-canary/summary.json [--out alerts.json] [--repo owner/name]
//
// Needs GITHUB_TOKEN with issues: write. Tested against a fake in alerts.test.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { envSecrets, redact } from './redact.mjs'
import { headline, stepsTable } from './summarize.mjs'

export const LABEL = 'prod-app-canary'
export const MARKER = '<!-- prod-app-canary -->'
const LABEL_COLOR = 'b60205'
const LABEL_DESCRIPTION = 'Opened and closed by the production app canary (canary/)'

const site = (summary) => summary.site?.replace(/^https?:\/\//, '') ?? 'production'
const runLine = (summary) => (summary.run_url ? `[Workflow run](${summary.run_url})` : 'run by hand')
const when = (summary) => summary.timestamp?.replace('T', ' ').replace(/\.\d+Z$/, ' UTC') ?? 'now'

export function title(summary) {
  return `Production app canary: ${summary.failing_step ? `"${summary.failing_step}"` : 'the journey'} is failing on ${site(summary)}`
}

const traceNote = (summary) =>
  summary.run_url
    ? `**Trace:** on the run, download the \`app-canary\` artifact; \`test-results/**/trace.zip\` opens with \`npx playwright show-trace trace.zip\` (or at trace.playwright.dev). The artifact also holds the screenshot and the HTML report.`
    : '**Trace:** `reports/app-canary/test-results/**/trace.zip` → `npx playwright show-trace`.'

const drillNote = (summary) =>
  summary.drill
    ? `\n> **This run was a drill (\`${summary.drill}\`):** the failure was deliberate, to prove this alert works end to end. The next real run closes this issue.\n`
    : ''

export function openedBody(summary) {
  return [
    MARKER,
    `${headline(summary)}, ${when(summary)}.`,
    '',
    `**Failing step:** ${summary.failing_step ?? 'before the first step'}`,
    `**Error:** \`${(summary.error ?? 'unknown').replace(/`/g, "'")}\``,
    `**Run:** ${runLine(summary)} · trigger: ${summary.trigger}`,
    '',
    stepsTable(summary),
    '',
    traceNote(summary),
    drillNote(summary),
    `This issue stays open while the canary keeps failing: each failing run comments here, and the first run that passes closes it. Label \`${LABEL}\`. Pause the canary with \`gh workflow disable "Production app canary"\`.`,
  ].join('\n')
}

export function stillFailingBody(summary) {
  return [
    `Still failing at **${summary.failing_step ?? 'the start'}**, ${when(summary)} (${summary.trigger}${summary.drill ? `, drill: ${summary.drill}` : ''}): \`${(summary.error ?? 'unknown').replace(/`/g, "'")}\``,
    '',
    stepsTable(summary),
    '',
    runLine(summary),
  ].join('\n')
}

export function recoveredBody(summary) {
  const how = summary.status === 'flaky' ? 'passed on its retry' : 'passed'
  return `Recovered: the canary ${how} at ${when(summary)} (${runLine(summary)}, ${summary.trigger}). Closing.`
}

/** Minimal GitHub REST client over fetch; one method per call the state machine makes. */
export class GitHubIssues {
  constructor({ repo, token, fetch: fetchImpl = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
    if (!repo) throw new Error('alerts: no repository (GITHUB_REPOSITORY or --repo)')
    if (!token) throw new Error('alerts: no GITHUB_TOKEN')
    this.repo = repo
    this.token = token
    this.fetch = fetchImpl
    this.apiUrl = apiUrl.replace(/\/+$/, '')
  }

  async request(method, path, body, { allow404 = false } = {}) {
    const res = await this.fetch(`${this.apiUrl}/repos/${this.repo}/${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 404 && allow404) return null
    if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${res.status}`)
    return res.status === 204 ? null : res.json()
  }

  /** Open issues the canary itself opened (label + marker), oldest first. */
  async openAlerts() {
    const issues = (await this.request('GET', `issues?labels=${LABEL}&state=open&per_page=50&sort=created&direction=asc`)) ?? []
    return issues.filter((i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(MARKER))
  }

  async ensureLabel() {
    const existing = await this.request('GET', `labels/${LABEL}`, undefined, { allow404: true })
    if (!existing) await this.request('POST', 'labels', { name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION })
  }

  async create(issueTitle, body) {
    return this.request('POST', 'issues', { title: issueTitle, body, labels: [LABEL] })
  }

  async comment(number, body) {
    await this.request('POST', `issues/${number}/comments`, { body })
  }

  async close(number) {
    await this.request('PATCH', `issues/${number}`, { state: 'closed', state_reason: 'completed' })
  }
}

/**
 * Brings the issues in line with this run. Returns what it did:
 * { action: 'opened' | 'commented' | 'closed' | 'none', issue, url }.
 */
export async function reconcile(issues, summary) {
  const open = await issues.openAlerts()
  if (summary.status === 'fail') {
    if (open.length) {
      await issues.comment(open[0].number, stillFailingBody(summary))
      return { action: 'commented', issue: open[0].number, url: open[0].html_url ?? null }
    }
    await issues.ensureLabel()
    const created = await issues.create(title(summary), openedBody(summary))
    return { action: 'opened', issue: created.number, url: created.html_url ?? null }
  }
  if (!open.length) return { action: 'none', issue: null, url: null }
  for (const issue of open) {
    await issues.comment(issue.number, recoveredBody(summary))
    await issues.close(issue.number)
  }
  return { action: 'closed', issue: open[0].number, url: open[0].html_url ?? null }
}

export function describe(result) {
  switch (result.action) {
    case 'opened':
      return `alert: opened issue #${result.issue} (${result.url ?? ''})`
    case 'commented':
      return `alert: still failing, commented on issue #${result.issue}`
    case 'closed':
      return `alert: recovered, closed issue #${result.issue}`
    default:
      return 'alert: nothing to do (passing, no open issue)'
  }
}

async function main(argv) {
  const [summaryPath, ...rest] = argv
  if (!summaryPath) {
    console.error('usage: node canary/alerts.mjs <summary.json> [--out alerts.json] [--repo owner/name]')
    return 2
  }
  const opt = (name) => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  // Belt and braces: the summary is already redacted; the issue text is public.
  for (const step of summary.steps ?? []) if (step.error) step.error = redact(step.error, envSecrets())
  if (summary.error) summary.error = redact(summary.error, envSecrets())

  const issues = new GitHubIssues({ repo: opt('--repo') ?? process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN })
  const result = await reconcile(issues, summary)
  console.log(describe(result))
  const out = opt('--out')
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(result, null, 2))
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const line = result.url ? `${describe(result).replace(/ \(.*\)$/, '')} → ${result.url}` : describe(result)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${line}\n`, { flag: 'a' })
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::${err.message}`)
      process.exit(1)
    },
  )
}
