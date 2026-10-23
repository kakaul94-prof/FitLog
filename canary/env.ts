// Where the production app canary points and who it signs in as.
//
// The values come from the environment (the workflow's secrets) or, by hand,
// from ai-evals/.env.canary: the same gitignored file the AI canary reads, so
// one file serves both canaries. A missing value STOPS the run and names what
// is missing. A canary that quietly skips is a canary that lies: the first
// prod-canary.yml turned missing secrets into a warning on the schedule and
// spent a week green without running once. Tested in preflight.test.ts.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const VARS = {
  CANARY_SUPABASE_URL: "the production Supabase project's URL (the deploy's PROD_VITE_SUPABASE_URL)",
  CANARY_SUPABASE_ANON_KEY: 'its publishable key (PROD_VITE_SUPABASE_ANON_KEY)',
  CANARY_EMAIL: "the monitor account's email: a user created in production for this and nothing else",
  CANARY_PASSWORD: "the monitor account's password",
} as const

export type VarName = keyof typeof VARS
export type Drill = 'none' | 'selector'
export const DRILLS: readonly Drill[] = ['none', 'selector']

/** The production site. CANARY_SITE_URL (the PROD_SITE_URL repository variable) overrides it. */
export const DEFAULT_SITE_URL = 'https://fitlog-prod.pages.dev'
export const ENV_FILE = fileURLToPath(new URL('../ai-evals/.env.canary', import.meta.url))

export interface Target {
  siteUrl: string
  supabaseUrl: string
  anonKey: string
  email: string
  password: string
  /** Ask the trainer too (one Claude call). The half-hour schedule turns it off. */
  trainer: boolean
  /** Break the run on purpose to prove the alerting: 'selector' asserts a heading that doesn't exist. */
  drill: Drill
}

export class MissingSecretsError extends Error {
  constructor(readonly missing: readonly VarName[]) {
    super(
      'The canary cannot run: these are not set, in the environment or in ai-evals/.env.canary:\n' +
        missing.map((name) => `  ${name}: ${VARS[name]}`).join('\n') +
        '\nA canary that skips is not a canary, so this is a failure, not a warning (canary/README.md).',
    )
    this.name = 'MissingSecretsError'
  }
}

type Env = Record<string, string | undefined>

const flag = (value: string | undefined, fallback: boolean): boolean =>
  value == null || value.trim() === '' ? fallback : !/^(false|0|no|off)$/i.test(value.trim())

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '')

/** The target from these variables. Throws MissingSecretsError naming every blank one. */
export function readTarget(env: Env): Target {
  const missing = (Object.keys(VARS) as VarName[]).filter((name) => !env[name]?.trim())
  if (missing.length) throw new MissingSecretsError(missing)

  const drill = (env.CANARY_DRILL?.trim() || 'none') as Drill
  if (!DRILLS.includes(drill)) throw new Error(`CANARY_DRILL must be one of ${DRILLS.join(', ')}, got "${drill}"`)

  return {
    siteUrl: trimSlash(env.CANARY_SITE_URL?.trim() || DEFAULT_SITE_URL),
    supabaseUrl: trimSlash(env.CANARY_SUPABASE_URL!),
    anonKey: env.CANARY_SUPABASE_ANON_KEY!.trim(),
    email: env.CANARY_EMAIL!.trim(),
    password: env.CANARY_PASSWORD!,
    trainer: flag(env.CANARY_TRAINER, true),
    drill,
  }
}

/** KEY=value lines; surrounding quotes dropped; blank lines and # comments ignored. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1)
    values[key] = value
  }
  return values
}

export function loadEnvFile(path: string = ENV_FILE): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {}
}

/** The environment wins; the file fills what it leaves blank. */
export function target(env: Env = process.env, file: string = ENV_FILE): Target {
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v != null && v !== ''))
  return readTarget({ ...loadEnvFile(file), ...set })
}
