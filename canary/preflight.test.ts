import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_SITE_URL, MissingSecretsError, parseEnvFile, readTarget, target, VARS } from './env'

// The canary's first job is to refuse to run quietly. Every way a secret can
// be missing must end in an error that names it, and nothing in here can turn
// that into a skip.

const complete = {
  CANARY_SUPABASE_URL: 'https://example.supabase.co/',
  CANARY_SUPABASE_ANON_KEY: 'sb_publishable_test',
  CANARY_EMAIL: 'canary@example.com',
  CANARY_PASSWORD: 'hunter2',
}

describe('a missing secret fails loudly', () => {
  test('with nothing set, every variable is named', () => {
    expect(() => readTarget({})).toThrow(MissingSecretsError)
    try {
      readTarget({})
    } catch (e) {
      const err = e as MissingSecretsError
      expect(err.missing).toEqual(Object.keys(VARS))
      for (const name of Object.keys(VARS)) expect(err.message).toContain(name)
      expect(err.message).toMatch(/failure, not a warning/)
    }
  })

  test.each(Object.keys(VARS))('%s alone missing is reported alone', (name) => {
    const env = { ...complete, [name]: undefined }
    expect(() => readTarget(env)).toThrow(MissingSecretsError)
    try {
      readTarget(env)
    } catch (e) {
      expect((e as MissingSecretsError).missing).toEqual([name])
    }
  })

  test('blank and whitespace count as missing', () => {
    expect(() => readTarget({ ...complete, CANARY_PASSWORD: '   ' })).toThrow(/CANARY_PASSWORD/)
    expect(() => readTarget({ ...complete, CANARY_EMAIL: '' })).toThrow(/CANARY_EMAIL/)
  })

  test('an unknown drill is an error, not a normal run', () => {
    expect(() => readTarget({ ...complete, CANARY_DRILL: 'bogus' })).toThrow(/CANARY_DRILL/)
  })
})

describe('a complete target', () => {
  test('defaults: the production site, the trainer on, no drill, slashes trimmed', () => {
    const t = readTarget(complete)
    expect(t).toEqual({
      siteUrl: DEFAULT_SITE_URL,
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'sb_publishable_test',
      email: 'canary@example.com',
      password: 'hunter2',
      trainer: true,
      drill: 'none',
    })
  })

  test('the site, the trainer switch and the drill come from the environment', () => {
    const t = readTarget({ ...complete, CANARY_SITE_URL: 'https://fitlog-9wl.pages.dev/', CANARY_TRAINER: 'false', CANARY_DRILL: 'selector' })
    expect(t.siteUrl).toBe('https://fitlog-9wl.pages.dev')
    expect(t.trainer).toBe(false)
    expect(t.drill).toBe('selector')
    expect(readTarget({ ...complete, CANARY_TRAINER: 'true' }).trainer).toBe(true)
    expect(readTarget({ ...complete, CANARY_TRAINER: '0' }).trainer).toBe(false)
  })
})

describe('the env file', () => {
  test('parses KEY=value, quotes and comments', () => {
    expect(parseEnvFile('# comment\n\nA=1\nB="two words"\nC=\'x\'\nbroken line\n=nokey\n')).toEqual({ A: '1', B: 'two words', C: 'x' })
  })

  test('fills what the environment leaves blank, and the environment wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-env-'))
    const file = join(dir, '.env.canary')
    writeFileSync(file, 'CANARY_EMAIL=file@example.com\nCANARY_PASSWORD=from-file\nCANARY_SITE_URL=https://from-file.test\n')
    const t = target({ CANARY_SUPABASE_URL: 'https://x.supabase.co', CANARY_SUPABASE_ANON_KEY: 'k', CANARY_EMAIL: 'env@example.com', CANARY_PASSWORD: '' }, file)
    expect(t.email).toBe('env@example.com') // set in the environment
    expect(t.password).toBe('from-file') // blank in the environment, so the file's
    expect(t.siteUrl).toBe('https://from-file.test')
  })

  test('a missing file is simply empty, so the environment alone must be complete', () => {
    expect(() => target({}, join(tmpdir(), 'does-not-exist', '.env.canary'))).toThrow(MissingSecretsError)
  })
})
