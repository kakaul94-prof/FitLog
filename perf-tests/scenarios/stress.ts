// Stress: 30 → 100 → 200 → 300 users in steps, to find where latency or errors
// break down. Report-only; aborts itself once errors stay above 10%.
import { REALISTIC_MIX } from '../journeys/index.ts'
import { defineScenario } from '../lib/scenario.ts'

const scenario = defineScenario('stress', REALISTIC_MIX)
export const options = scenario.options
export const setup = scenario.setup
export const teardown = scenario.teardown
export const handleSummary = scenario.handleSummary
export default scenario.run
