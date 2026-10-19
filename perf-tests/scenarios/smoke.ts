// Smoke: two users for a minute, few pauses. Do the scripts and the stack work?
// Zero errors allowed; runs on every PR (ci.yml → perf-smoke).
import { REALISTIC_MIX } from '../journeys/index.ts'
import { defineScenario } from '../lib/scenario.ts'

const scenario = defineScenario('smoke', REALISTIC_MIX)
export const options = scenario.options
export const setup = scenario.setup
export const teardown = scenario.teardown
export const handleSummary = scenario.handleSummary
export default scenario.run
