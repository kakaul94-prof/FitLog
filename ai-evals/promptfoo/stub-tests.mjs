// The CI subset (promptfooconfig.stub.yaml): the ten canary cases, rule
// assertions only, logs rendered for a fixed date so every run is identical.
import { buildTests } from './tests.mjs'

export default async function generate() {
  return buildTests({ set: 'canary', judge: false, today: '2026-10-28' })
}
