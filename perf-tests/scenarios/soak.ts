// Soak: expected load held for a long time (SOAK_DURATION, 60 m by default,
// 10 m nightly in CI). Budgets enforced, plus a drift check: the last third of
// the run may not be more than 1.25× slower (p95) than the first.
import { REALISTIC_MIX } from '../journeys/index.ts'
import { defineScenario } from '../lib/scenario.ts'

const scenario = defineScenario('soak', REALISTIC_MIX)
export const options = scenario.options
export const setup = scenario.setup
export const teardown = scenario.teardown
export const handleSummary = scenario.handleSummary
export default scenario.run
