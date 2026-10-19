// Which third of the run a request belongs to. Every journey request carries a
// `phase` tag, so the soak's drift check can compare the last third of the run
// with the first (config/thresholds.ts surfaces both as sub-metrics).
//
// The clock starts when the VUs do, not when k6 does: setup() (seeding) can
// take a minute, which k6's own run clock includes.
let runStartMs = 0
let runLengthMs = 0

/** Called from the per-iteration function with the start time setup() recorded. */
export function setRunWindow(startMs: number, lengthMs: number): void {
  runStartMs = startMs
  runLengthMs = lengthMs
}

export type Phase = 'first' | 'middle' | 'last'

export function currentPhase(): Phase {
  if (!runStartMs || !runLengthMs) return 'middle'
  const fraction = (Date.now() - runStartMs) / runLengthMs
  return fraction < 1 / 3 ? 'first' : fraction < 2 / 3 ? 'middle' : 'last'
}
