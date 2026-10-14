// Turns a scenario name and a journey mix into everything k6 needs: options
// (ramp, thresholds), setup (users + history), the per-iteration function,
// teardown (delete the users) and the summary handler. A scenario file is then
// a handful of lines (see scenarios/load.ts).
import type { Options } from 'k6/options'
import { resolveProfile, type ScenarioName } from '../config/profiles.ts'
import { thresholdsFor } from '../config/thresholds.ts'
import { askTrainerOnce } from '../journeys/askTrainer.ts'
import { signIn } from './auth.ts'
import { loadEnv } from './env.ts'
import { available, runOne, type Weighted } from './mix.ts'
import { setRunWindow } from './phase.ts'
import { deletePool, seedPool, type SetupData } from './seed.ts'
import { buildHeadline, textSummary, type SummaryData } from './summary.ts'
import { setThinkScale, think } from './think.ts'
import { contextFor } from './users.ts'

export function defineScenario(name: ScenarioName, mix: Weighted[]) {
  // Init context: the local-only guard runs here, before k6 starts anything.
  const env = loadEnv()
  const profile = resolveProfile(name)
  const journeys = available(mix, env)
  setThinkScale(profile.thinkScale)
  const outDir = __ENV.PERF_OUT || `reports/perf/${name}`

  const thresholds = thresholdsFor(profile)
  // Surface each journey's count and duration in the summary (never fails).
  for (const j of journeys) {
    thresholds[`journeys{journey:${j.name}}`] = ['count>=0']
    thresholds[`journey_duration{journey:${j.name}}`] = ['p(95)>=0']
  }
  thresholds['http_req_duration{scope:journey}'] = ['p(95)>=0']
  for (const op of ['search', 'read', 'write', 'auth', 'fn', 'signin']) thresholds[`http_reqs{op:${op}}`] = ['count>=0']
  for (const op of ['fn', 'signin']) thresholds[`http_req_duration{op:${op}}`] = ['p(95)>=0'] // reported, not budgeted

  const options: Options = {
    scenarios: {
      [name]: { executor: 'ramping-vus', startVUs: 0, stages: profile.stages, gracefulRampDown: '30s', gracefulStop: '30s' },
    },
    thresholds,
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
    setupTimeout: '15m',
    teardownTimeout: '10m',
    userAgent: 'fitlog-perf-tests (k6)',
  }

  return {
    options,
    setup(): SetupData {
      const data = seedPool(env, profile)
      const rows = Object.entries(data.rows).map(([t, n]) => `${t} ${n}`).join(', ')
      console.log(`setup: ${data.users.length} users × ${data.seedDays} days in ${(data.setupMs / 1000).toFixed(1)}s (${rows})`)
      // Pre-flight, outside every budget (scope:setup): a sign-in proves the
      // seeded credentials work, and one trainer call proves the functions
      // server is wired to this stack and pays its cold start (wrangler loads
      // the function on first use) before any VU is measured.
      const probe = signIn(env, data.users[0].email, data.users[0].password, 'setup')
      if (env.functionsUrl) {
        const res = askTrainerOnce(env, probe.accessToken, 'setup')
        if (res.status !== 200) {
          throw new Error(`the functions server at ${env.functionsUrl} answered ${res.status} to a signed-in trainer call: ${String(res.body).slice(0, 200)}`)
        }
      }
      return { ...data, runStartedAt: Date.now() }
    },
    run(data: SetupData): void {
      setRunWindow(data.runStartedAt, profile.totalMs)
      const ctx = contextFor(env, data)
      runOne(ctx, journeys)
      think(2, 6) // between visits
    },
    teardown(data: SetupData): void {
      deletePool(env, data.users)
    },
    handleSummary(data: SummaryData): Record<string, string> {
      const headline = buildHeadline(data, profile, journeys.map((j) => j.name))
      return {
        stdout: textSummary(headline),
        [`${outDir}/summary.json`]: JSON.stringify(data),
        [`${outDir}/headline.json`]: JSON.stringify(headline, null, 2),
      }
    },
  }
}
