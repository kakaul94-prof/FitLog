// Spike: 10 users, then 250 within ten seconds (everyone opens the app at
// once), a minute at the top, back to 10. Does it recover? Report-only.
import { REALISTIC_MIX } from '../journeys/index.ts'
import { defineScenario } from '../lib/scenario.ts'

const scenario = defineScenario('spike', REALISTIC_MIX)
export const options = scenario.options
export const setup = scenario.setup
export const teardown = scenario.teardown
export const handleSummary = scenario.handleSummary
export default scenario.run
