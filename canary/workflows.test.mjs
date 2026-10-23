import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

// Both production canaries must FAIL when a secret is missing, on every
// trigger. The first prod-canary.yml turned a missing secret into a warning on
// scheduled runs and skipped every step, so twelve scheduled runs showed green
// while no canary ever ran. This pins the workflow files themselves so that
// pattern cannot come back without this test going red.
const workflow = (name) => readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), 'utf8')

/** The text of the step named `name`, up to the next step. */
function stepText(yaml, name) {
  const start = yaml.indexOf(`- name: ${name}`)
  if (start < 0) throw new Error(`no step named "${name}"`)
  const rest = yaml.slice(start + 1)
  const next = rest.search(/\n\s*- (name|uses|if):/)
  return rest.slice(0, next < 0 ? undefined : next)
}

describe.each(['app-canary.yml', 'prod-canary.yml'])('%s fails loudly on a missing secret', (file) => {
  const yaml = workflow(file)
  const gate = stepText(yaml, 'Check the secrets are configured')

  test('the gate step is first and exits non-zero', () => {
    expect(yaml.indexOf('- name: Check the secrets are configured')).toBeLessThan(yaml.indexOf('uses: actions/checkout'))
    expect(gate).toMatch(/exit 1/)
    expect(gate).toMatch(/::error::/)
  })

  test('nothing turns the missing secret into a warning or a skip', () => {
    expect(gate).not.toMatch(/::warning::/)
    expect(gate).not.toMatch(/skipp?(ed|ing)/i)
    expect(yaml).not.toMatch(/ready=false/)
    expect(yaml).not.toMatch(/outputs\.ready/)
  })

  test('scheduled runs get no special treatment', () => {
    expect(gate).not.toMatch(/event_name == 'schedule'/)
    expect(gate).not.toMatch(/SCHEDULED/)
  })

  test('every secret the run needs is checked by the gate', () => {
    for (const secret of ['PROD_VITE_SUPABASE_URL', 'PROD_VITE_SUPABASE_ANON_KEY', 'PROD_CANARY_EMAIL', 'PROD_CANARY_PASSWORD']) {
      expect(gate).toContain(`secrets.${secret}`)
      expect(gate).toContain(`missing+=(${secret})`)
    }
  })
})

describe('app-canary.yml runs when it should', () => {
  const yaml = workflow('app-canary.yml')

  test('every 30 minutes, the trainer on the hour only', () => {
    expect(yaml).toContain("- cron: '0 * * * *'")
    expect(yaml).toContain("- cron: '30 * * * *'")
    expect(yaml).toMatch(/CANARY_TRAINER:.*github\.event\.schedule == '0 \* \* \* \*'/)
  })

  test('after every production deploy (CI finishing green on main)', () => {
    expect(yaml).toMatch(/workflow_run:\s*\n\s*workflows: \[CI\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/)
    expect(yaml).toContain("github.event.workflow_run.conclusion == 'success'")
  })

  test('alerts and the dashboard run whether the canary passed or failed', () => {
    for (const step of ['Summarize the run', 'Open, update or close the alert issue', 'Upload the results', 'Publish to the dashboard']) {
      expect(stepText(yaml, step)).toMatch(/if: \$\{\{ !cancelled\(\)/)
    }
  })
})
