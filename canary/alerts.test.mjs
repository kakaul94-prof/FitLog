import { describe, expect, test } from 'vitest'
import { GitHubIssues, LABEL, MARKER, openedBody, reconcile, recoveredBody, stillFailingBody, title } from './alerts.mjs'
import { STEPS } from './steps.mjs'

// The state machine against a fake GitHub: one issue per outage, opened by
// the first failing run, commented on by the next, closed by the first pass.

const summary = (over = {}) => ({
  schema: 1,
  timestamp: '2026-10-22T12:00:00.000Z',
  run_id: '42',
  run_url: 'https://github.com/o/r/actions/runs/42',
  trigger: 'schedule',
  site: 'https://fitlog-prod.pages.dev',
  trainer: true,
  drill: null,
  status: 'fail',
  attempts: 2,
  duration_ms: 20000,
  steps: [
    { name: STEPS[0], status: 'pass', duration_ms: 3000 },
    { name: STEPS[1], status: 'fail', duration_ms: 15000, error: 'Error: expect(locator).toBeVisible() failed' },
    { name: STEPS[2], status: 'skipped', duration_ms: null },
    { name: STEPS[3], status: 'skipped', duration_ms: null },
    { name: STEPS[4], status: 'skipped', duration_ms: null },
  ],
  failing_step: STEPS[1],
  error: 'Error: expect(locator).toBeVisible() failed',
  ...over,
})

const passing = (over = {}) =>
  summary({ status: 'pass', attempts: 1, steps: STEPS.map((name) => ({ name, status: 'pass', duration_ms: 1000 })), failing_step: null, error: null, ...over })

class FakeIssues {
  constructor(open = []) {
    this.open = open
    this.calls = []
    this.nextNumber = 7
  }
  async openAlerts() {
    this.calls.push(['openAlerts'])
    return this.open
  }
  async ensureLabel() {
    this.calls.push(['ensureLabel'])
  }
  async create(issueTitle, body) {
    this.calls.push(['create', issueTitle, body])
    return { number: this.nextNumber, html_url: `https://github.com/o/r/issues/${this.nextNumber}` }
  }
  async comment(number, body) {
    this.calls.push(['comment', number, body])
  }
  async close(number) {
    this.calls.push(['close', number])
  }
}

const kinds = (fake) => fake.calls.map((c) => c[0])

describe('reconcile', () => {
  test('the first failing run opens one issue, with the label, the marker, the step, the run and the trace', async () => {
    const fake = new FakeIssues()
    const result = await reconcile(fake, summary())
    expect(kinds(fake)).toEqual(['openAlerts', 'ensureLabel', 'create'])
    expect(result).toEqual({ action: 'opened', issue: 7, url: 'https://github.com/o/r/issues/7' })
    const [, issueTitle, body] = fake.calls[2]
    expect(issueTitle).toBe('Production app canary: "Load the diary" is failing on fitlog-prod.pages.dev')
    expect(body.startsWith(MARKER)).toBe(true)
    expect(body).toContain('**Failing step:** Load the diary')
    expect(body).toContain('`Error: expect(locator).toBeVisible() failed`')
    expect(body).toContain('https://github.com/o/r/actions/runs/42')
    expect(body).toContain('trace.zip')
    expect(body).toContain('npx playwright show-trace')
    expect(body).toContain(LABEL)
    for (const name of STEPS) expect(body).toContain(name)
    expect(body).not.toMatch(/drill/i)
  })

  test('a later failing run comments on the open issue and opens no second one', async () => {
    const fake = new FakeIssues([{ number: 7, html_url: 'https://github.com/o/r/issues/7', body: `${MARKER}\nopen` }])
    const result = await reconcile(fake, summary({ run_id: '43', run_url: 'https://github.com/o/r/actions/runs/43', failing_step: STEPS[0], error: 'Error: still down' }))
    expect(kinds(fake)).toEqual(['openAlerts', 'comment'])
    expect(result).toEqual({ action: 'commented', issue: 7, url: 'https://github.com/o/r/issues/7' })
    expect(fake.calls[1][2]).toContain('Still failing at **Sign in**')
    expect(fake.calls[1][2]).toContain('runs/43')
  })

  test('the first passing run comments and closes the open issue', async () => {
    const fake = new FakeIssues([{ number: 7, html_url: 'https://github.com/o/r/issues/7', body: `${MARKER}\nopen` }])
    const result = await reconcile(fake, passing())
    expect(kinds(fake)).toEqual(['openAlerts', 'comment', 'close'])
    expect(fake.calls[1][2]).toMatch(/^Recovered: the canary passed/)
    expect(fake.calls[2]).toEqual(['close', 7])
    expect(result).toEqual({ action: 'closed', issue: 7, url: 'https://github.com/o/r/issues/7' })
  })

  test('a pass on the retry counts as recovery, and says so', async () => {
    const fake = new FakeIssues([{ number: 7, body: `${MARKER}` }])
    await reconcile(fake, passing({ status: 'flaky', attempts: 2 }))
    expect(kinds(fake)).toEqual(['openAlerts', 'comment', 'close'])
    expect(fake.calls[1][2]).toContain('passed on its retry')
  })

  test('a passing run with nothing open does nothing', async () => {
    const fake = new FakeIssues()
    expect(await reconcile(fake, passing())).toEqual({ action: 'none', issue: null, url: null })
    expect(kinds(fake)).toEqual(['openAlerts'])
  })

  test('two open alerts (a race between runs) are both closed on recovery', async () => {
    const fake = new FakeIssues([{ number: 7, body: MARKER }, { number: 8, body: MARKER }])
    const result = await reconcile(fake, passing())
    expect(fake.calls.filter((c) => c[0] === 'close').map((c) => c[1])).toEqual([7, 8])
    expect(result.issue).toBe(7)
  })

  test('a drill says it was one, and that the next real run closes it', async () => {
    const fake = new FakeIssues()
    await reconcile(fake, summary({ drill: 'selector', trigger: 'manual' }))
    const body = fake.calls[2][2]
    expect(body).toContain('This run was a drill (`selector`)')
    expect(body).toContain('The next real run closes this issue')
  })

  test('bodies never carry a failure outside the steps as a step', () => {
    const s = summary({ failing_step: null, error: 'the canary produced no report: it did not start (see the run log)' })
    expect(title(s)).toBe('Production app canary: the journey is failing on fitlog-prod.pages.dev')
    expect(openedBody(s)).toContain('**Failing step:** before the first step')
    expect(stillFailingBody(s)).toContain('Still failing at **the start**')
    expect(recoveredBody(passing({ run_url: null }))).toContain('run by hand')
  })
})

describe('GitHubIssues over fetch', () => {
  const calls = []
  const fetchFake = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
    const path = url.replace('https://api.github.com/repos/o/r/', '')
    if (path.startsWith('issues?')) {
      return json(200, [
        { number: 1, body: `${MARKER}\nours`, html_url: 'u1' },
        { number: 2, body: 'a person\'s own issue with our label', html_url: 'u2' },
        { number: 3, body: MARKER, pull_request: {}, html_url: 'u3' },
      ])
    }
    if (path === `labels/${LABEL}`) return json(404, { message: 'Not Found' })
    if (path === 'labels') return json(201, { name: LABEL })
    if (path === 'issues') return json(201, { number: 9, html_url: 'https://github.com/o/r/issues/9' })
    if (path === 'issues/9/comments') return json(201, {})
    if (path === 'issues/9') return json(200, {})
    return json(500, { message: `unexpected ${path}` })
  }
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

  test('lists only the canary\'s own open issues, creates the label when missing, opens, comments and closes', async () => {
    const gh = new GitHubIssues({ repo: 'o/r', token: 'tok', fetch: fetchFake })
    const open = await gh.openAlerts()
    expect(open.map((i) => i.number)).toEqual([1]) // not the person's issue, not the PR
    expect(calls[0].url).toContain(`issues?labels=${LABEL}&state=open`)
    expect(calls[0].headers.authorization).toBe('Bearer tok')

    await gh.ensureLabel()
    expect(calls.slice(1).map((c) => [c.method, c.url.split('/repos/o/r/')[1]])).toEqual([['GET', `labels/${LABEL}`], ['POST', 'labels']])
    expect(calls[2].body).toMatchObject({ name: LABEL })

    const created = await gh.create('t', 'b')
    expect(created.number).toBe(9)
    expect(calls[3].body).toEqual({ title: 't', body: 'b', labels: [LABEL] })

    await gh.comment(9, 'c')
    expect(calls[4]).toMatchObject({ method: 'POST', body: { body: 'c' } })
    await gh.close(9)
    expect(calls[5]).toMatchObject({ method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } })
  })

  test('refuses to start without a repository or a token, and surfaces HTTP failures', async () => {
    expect(() => new GitHubIssues({ repo: '', token: 'x' })).toThrow(/repository/)
    expect(() => new GitHubIssues({ repo: 'o/r', token: '' })).toThrow(/GITHUB_TOKEN/)
    const gh = new GitHubIssues({ repo: 'o/r', token: 'tok', fetch: async () => json(403, {}) })
    await expect(gh.openAlerts()).rejects.toThrow(/HTTP 403/)
  })
})
