// Load: the realistic mix at expected load (30 users, 5 minutes steady),
// budgets enforced. The nightly baseline (perf.yml).
import { REALISTIC_MIX } from '../journeys/index.ts'
import { defineScenario } from '../lib/scenario.ts'

const scenario = defineScenario('load', REALISTIC_MIX)
export const options = scenario.options
export const setup = scenario.setup
export const teardown = scenario.teardown
export const handleSummary = scenario.handleSummary
export default scenario.run
