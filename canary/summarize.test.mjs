import { describe, expect, test } from 'vitest'
import { envSecrets, firstLine, redact } from './redact.mjs'
import { STEPS } from './steps.mjs'
import { collectTests, headline, metaFromEnv, stepsTable, summarize } from './summarize.mjs'

// A Playwright JSON report, as the json reporter writes it, with only what
// summarize.mjs reads: one spec, its attempts, their steps and annotations.
const step = (title, duration, error) => ({ title, duration, ...(error ? { error: { message: error } } : {}) })
const allPass = STEPS.map((name, i) => step(name, (i + 1) * 1000))
const result = (status, steps, extra = {}) => ({ status, duration: steps.reduce((s, x) => s + x.duration, 0), steps, retry: 0, ...extra })
const report = (results, annotations = [{ type: 'site', description: 'https://fitlog-prod.pages.dev' }, { type: 'trainer', description: 'true' }, { type: 'drill', description: 'none' }]) => ({
  suites: [{ title: 'canary.spec.ts', specs: [{ title: 'the production journey', tests: [{ results, annotations, status: 'expected' }] }], suites: [] }],
})
const meta = { run_id: '42', run_url: 'https://github.com/o/r/actions/runs/42', trigger: 'schedule', timestamp: '2026-10-22T12:00:00.000Z' }

describe('summarize', () => {
  test('a clean pass: every step with its duration', () => {
    const s = summarize(report([result('passed', allPass)]), meta)
    expect(s.status).toBe('pass')
    expect(s.attempts).toBe(1)
    expect(s.failing_step).toBeNull()
    expect(s.error).toBeNull()
    expect(s.site).toBe('https://fitlog-prod.pages.dev')
    expect(s.trainer).toBe(true)
    expect(s.drill).toBeNull()
    expect(s.duration_ms).toBe(15000)
    expect(s.steps).toEqual(STEPS.map((name, i) => ({ name, status: 'pass', duration_ms: (i + 1) * 1000 })))
    expect(s).toMatchObject({ run_id: '42', run_url: meta.run_url, trigger: 'schedule', timestamp: meta.timestamp, schema: 1 })
  })

  test('a failure names the step, keeps its first error line and marks the rest skipped', () => {
    const steps = [step(STEPS[0], 3000), step(STEPS[1], 15000, '\u001b[31mError: expect(locator).toBeVisible() failed\u001b[0m\n\nLocator: getByRole(\'heading\')\nExpected: visible')]
    const s = summarize(report([result('failed', steps, { errors: [{ message: 'Error: expect(locator).toBeVisible() failed' }] })]), meta)
    expect(s.status).toBe('fail')
    expect(s.failing_step).toBe(STEPS[1])
    expect(s.error).toBe('Error: expect(locator).toBeVisible() failed')
    expect(s.steps.map((x) => x.status)).toEqual(['pass', 'fail', 'skipped', 'skipped', 'skipped'])
    expect(s.steps[1].error).toBe('Error: expect(locator).toBeVisible() failed')
  })

  test('passing on the retry is flaky, never a clean pass, and reports the last attempt', () => {
    const s = summarize(report([result('failed', [step(STEPS[0], 2000, 'Error: boom')]), result('passed', allPass, { retry: 1 })]), meta)
    expect(s.status).toBe('flaky')
    expect(s.attempts).toBe(2)
    expect(s.failing_step).toBeNull()
    expect(s.steps.every((x) => x.status === 'pass')).toBe(true)
  })

  test('the trainer step is "off", not "skipped", when the run was asked not to ask', () => {
    const s = summarize(report([result('passed', allPass.slice(0, 4))], [{ type: 'trainer', description: 'false' }]), meta)
    expect(s.status).toBe('pass')
    expect(s.trainer).toBe(false)
    expect(s.steps[4]).toEqual({ name: STEPS[4], status: 'off', duration_ms: null })
  })

  test('a drill is recorded as one', () => {
    const s = summarize(report([result('failed', [step(STEPS[0], 1000), step(STEPS[1], 3000, 'Error: no such heading')])], [{ type: 'drill', description: 'selector' }]), meta)
    expect(s.drill).toBe('selector')
    expect(s.failing_step).toBe(STEPS[1])
  })

  test('a failure outside any step still has an error, and no failing step', () => {
    const s = summarize(report([result('failed', [], { errors: [{ message: 'Error: browserType.launch: Executable does not exist' }] })]), meta)
    expect(s.status).toBe('fail')
    expect(s.failing_step).toBeNull()
    expect(s.error).toMatch(/Executable does not exist/)
    expect(s.steps.every((x) => x.status === 'skipped')).toBe(true)
  })

  test('no report at all is a failure that says so', () => {
    const s = summarize(null, meta)
    expect(s.status).toBe('fail')
    expect(s.attempts).toBe(0)
    expect(s.error).toMatch(/did not start/)
    expect(s.site).toBeNull()
  })

  test('the monitor account never reaches the record', () => {
    const steps = [step(STEPS[0], 1000, 'Error: sign-in failed for canary@fitlog.monitor with password Tr0ub4dor&3 (token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop)')]
    const s = summarize(report([result('failed', steps)]), { ...meta, secrets: ['Tr0ub4dor&3', 'canary@fitlog.monitor'] })
    expect(s.error).not.toContain('Tr0ub4dor&3')
    expect(s.error).not.toContain('canary@fitlog.monitor')
    expect(s.error).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(s.error).toContain('[redacted]')
  })

  test('the markdown table lists every step and the headline says what happened', () => {
    const s = summarize(report([result('failed', [step(STEPS[0], 1200), step(STEPS[1], 15000, 'Error: nope')])]), meta)
    const table = stepsTable(s)
    for (const name of STEPS) expect(table).toContain(name)
    expect(table).toContain('1.2 s')
    expect(table).toContain('`Error: nope`')
    expect(headline(s)).toBe('Production app canary failed at **Load the diary** on https://fitlog-prod.pages.dev (schedule)')
    expect(headline(summarize(report([result('passed', allPass)]), { ...meta, trigger: 'deploy' }))).toMatch(/passed on .* \(deploy\)$/)
  })

  test('collectTests finds specs however the suites nest', () => {
    const nested = { suites: [{ suites: [{ specs: [{ title: 'inner', tests: [{ results: [] }] }] }], specs: [{ title: 'outer', tests: [{ results: [] }] }] }] }
    expect(collectTests(nested).map((t) => t.title)).toEqual(['outer', 'inner'])
    expect(collectTests(null)).toEqual([])
  })

  test('metaFromEnv builds the run link from the Actions environment', () => {
    const m = metaFromEnv({ GITHUB_RUN_ID: '9', GITHUB_REPOSITORY: 'o/r', TRIGGER: 'deploy', CANARY_TRAINER: 'false', CANARY_DRILL: 'selector', CANARY_PASSWORD: 'secret-pw', CANARY_EMAIL: 'c@x.io' })
    expect(m).toMatchObject({ run_id: '9', run_url: 'https://github.com/o/r/actions/runs/9', trigger: 'deploy', trainer: false, drill: 'selector', secrets: ['secret-pw', 'c@x.io'] })
    expect(metaFromEnv({})).toMatchObject({ run_id: null, run_url: null, trigger: 'local', trainer: undefined })
  })
})

describe('redact', () => {
  test('strips ANSI colour, emails, JWTs, Supabase keys, bearer tokens and query strings', () => {
    const text = '\u001b[31mfailed\u001b[0m for a.user+test@example.co.uk: Bearer abc.def-123 key sb_publishable_AbC123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U url https://x.supabase.co/rest/v1/diary_entries?food_name=eq.Oats&select=*'
    const out = redact(text)
    expect(out).not.toMatch(/\u001b/)
    expect(out).not.toContain('example.co.uk')
    expect(out).not.toContain('abc.def-123')
    expect(out).not.toContain('sb_publishable_AbC123')
    expect(out).not.toContain('eyJhbGci')
    expect(out).not.toContain('Oats')
    expect(out).toBe('failed for [email]: Bearer [token] key [key] jwt [jwt] url https://x.supabase.co/rest/v1/diary_entries?[query]')
  })

  test('removes given secrets wherever they appear', () => {
    expect(redact('password "hunter22" rejected', ['hunter22'])).toBe('password "[redacted]" rejected')
    expect(envSecrets({ CANARY_PASSWORD: 'pw-long', CANARY_EMAIL: 'c@x.io' })).toEqual(['pw-long', 'c@x.io'])
    expect(envSecrets({ CANARY_PASSWORD: 'abc' })).toEqual([]) // too short to search for safely
  })

  test('firstLine keeps the first non-blank line, within a limit', () => {
    expect(firstLine('\n\n  Error: one\nmore')).toBe('  Error: one')
    expect(firstLine('x'.repeat(400), 10)).toHaveLength(10)
    expect(firstLine(undefined)).toBe('')
  })
})
