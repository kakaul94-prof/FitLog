// The shape of each scenario: how many virtual users, for how long, with how
// much seeded history, and whether its budgets are enforced or only reported.
//
// Overrides, all optional, read from the environment (run.sh passes them on):
//   VUS=<n>            scale the whole ramp so it peaks at n users
//   SOAK_DURATION=30m  the soak's steady hold (CI uses 10m; by hand it is 60m)
//   THINK_SCALE=0.5    multiply every think time (0 = no pauses at all)
//   POOL_SIZE=<n>      how many seeded users the virtual users share
//   SEED_DAYS=<n>      days of history seeded per user
// Hard caps apply after overrides: nothing here can run 400+ users or past 8 h.
export type ScenarioName = 'smoke' | 'load' | 'stress' | 'spike' | 'soak'

export interface Stage {
  duration: string
  target: number
}

export interface Profile {
  name: ScenarioName
  stages: Stage[]
  peakVus: number
  totalMs: number
  thinkScale: number
  /** Seeded users. Virtual users share them round-robin, each with its own session. */
  pool: number
  /** Days of history (foods, diary, workouts, weigh-ins) seeded per user. */
  seedDays: number
  /** Budgets are reported but a breach doesn't fail the run (stress, spike). */
  reportOnly: boolean
  /** Failed-request rate the run may not exceed. */
  errorBudget: number
}

export const MAX_VUS = 400
export const MAX_POOL = 100
export const MAX_DURATION_MS = 8 * 60 * 60 * 1000

type Base = Omit<Profile, 'name' | 'peakVus' | 'totalMs'>

// "Expected load" is 30 concurrent users. FitLog has one real user today, so this
// is a deliberately generous planning target, not a measurement; the README says so.
const EXPECTED_VUS = 30

const BASE: Record<ScenarioName, Base> = {
  // Does the stack answer and do the scripts run? Two users, a minute, few pauses.
  // (Both users from the start: a single 0→2 ramp would only reach the second
  // user as the minute ends.)
  smoke: {
    stages: [
      { duration: '5s', target: 2 },
      { duration: '55s', target: 2 },
    ],
    thinkScale: 0.25,
    pool: 3,
    seedDays: 14,
    reportOnly: false,
    errorBudget: 0,
  },
  // The realistic mix at the expected level, held long enough for p99 to settle.
  load: {
    stages: [
      { duration: '1m', target: EXPECTED_VUS },
      { duration: '5m', target: EXPECTED_VUS },
      { duration: '30s', target: 0 },
    ],
    thinkScale: 1,
    pool: EXPECTED_VUS,
    seedDays: 90,
    reportOnly: false,
    errorBudget: 0.005,
  },
  // Steps well past expected load to find where latency or errors break down.
  // Report-only: the point is the shape of the curve, not a pass mark. The run
  // aborts itself if errors stay above 10% (config/thresholds.ts).
  stress: {
    stages: [
      { duration: '30s', target: 30 },
      { duration: '90s', target: 30 },
      { duration: '30s', target: 100 },
      { duration: '90s', target: 100 },
      { duration: '30s', target: 200 },
      { duration: '90s', target: 200 },
      { duration: '30s', target: 300 },
      { duration: '90s', target: 300 },
      { duration: '30s', target: 0 },
    ],
    thinkScale: 1,
    pool: 60,
    seedDays: 90,
    reportOnly: true,
    errorBudget: 0.005,
  },
  // A sudden jump (everyone opens the app at once), then does it recover?
  spike: {
    stages: [
      { duration: '30s', target: 10 },
      { duration: '10s', target: 250 },
      { duration: '1m', target: 250 },
      { duration: '10s', target: 10 },
      { duration: '2m', target: 10 },
      { duration: '10s', target: 0 },
    ],
    thinkScale: 1,
    pool: 60,
    seedDays: 90,
    reportOnly: true,
    errorBudget: 0.005,
  },
  // Expected load, held for a long time: slow degradation (leaks, pool
  // exhaustion, table bloat) shows as the last third drifting past the first.
  soak: {
    stages: [
      { duration: '1m', target: EXPECTED_VUS },
      { duration: '60m', target: EXPECTED_VUS }, // replaced by SOAK_DURATION
      { duration: '30s', target: 0 },
    ],
    thinkScale: 1,
    pool: EXPECTED_VUS,
    seedDays: 90,
    reportOnly: false,
    errorBudget: 0.005,
  },
}

export const SCENARIO_NAMES = Object.keys(BASE) as ScenarioName[]

/** '90s', '5m', '1h30m' → milliseconds. */
export function parseDuration(text: string): number {
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s|ms)/g
  let ms = 0
  let matched = ''
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(m[1])
    ms += m[2] === 'h' ? n * 3600_000 : m[2] === 'm' ? n * 60_000 : m[2] === 's' ? n * 1000 : n
    matched += m[0]
  }
  if (!matched || matched.replace(/\s/g, '') !== text.replace(/\s/g, '')) {
    throw new Error(`'${text}' is not a duration like 90s, 5m or 1h30m`)
  }
  return ms
}

function numberFrom(name: string, fallback: number): number {
  const raw = __ENV[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got '${raw}'`)
  return n
}

export function resolveProfile(name: ScenarioName): Profile {
  const base = BASE[name]
  if (!base) throw new Error(`Unknown scenario '${name}'; one of ${SCENARIO_NAMES.join(', ')}`)
  let stages = base.stages.map((s) => ({ ...s }))

  if (name === 'soak' && __ENV.SOAK_DURATION) stages[1] = { ...stages[1], duration: __ENV.SOAK_DURATION }

  const basePeak = Math.max(...stages.map((s) => s.target))
  const wantedPeak = numberFrom('VUS', basePeak)
  if (wantedPeak !== basePeak) {
    const factor = wantedPeak / basePeak
    stages = stages.map((s) => ({ ...s, target: Math.round(s.target * factor) }))
  }
  const peakVus = Math.max(...stages.map((s) => s.target))
  if (peakVus > MAX_VUS) throw new Error(`${peakVus} virtual users is over the cap of ${MAX_VUS}`)
  if (peakVus < 1) throw new Error('the scenario needs at least one virtual user')

  const totalMs = stages.reduce((sum, s) => sum + parseDuration(s.duration), 0)
  if (totalMs > MAX_DURATION_MS) throw new Error(`${totalMs / 60_000} minutes is over the cap of ${MAX_DURATION_MS / 3600_000} h`)

  const pool = Math.min(MAX_POOL, Math.max(1, Math.round(numberFrom('POOL_SIZE', Math.min(base.pool, peakVus)))))
  const seedDays = Math.max(1, Math.round(numberFrom('SEED_DAYS', base.seedDays)))
  const thinkScale = numberFrom('THINK_SCALE', base.thinkScale)

  return { ...base, name, stages, peakVus, totalMs, pool, seedDays, thinkScale }
}
