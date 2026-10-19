// A scenario's traffic is a weighted mix of journeys: each iteration, a VU picks
// one by weight and runs it start to finish, with think time, like one visit to
// the app. Every journey is counted and timed under its own name, so the
// summary can say "logWorkout: 412 runs, p95 48 s".
import { Counter, Trend } from 'k6/metrics'
import type { Env } from './env.ts'
import type { Ctx } from './users.ts'

export type Journey = (ctx: Ctx) => void

export interface Weighted {
  name: string
  /** Relative frequency; weights need not add up to 100. */
  weight: number
  run: Journey
  /** Only runs when the Pages Functions server is up (the trainer journey). */
  needs?: 'functions'
}

const journeys = new Counter('journeys')
const journeyDuration = new Trend('journey_duration', true)

/** The journeys this run can actually make, given what is running. */
export function available(mix: Weighted[], env: Env): Weighted[] {
  const out = mix.filter((j) => j.needs !== 'functions' || env.functionsUrl)
  if (out.length !== mix.length) {
    console.warn(`FITLOG_FUNCTIONS_URL is not set: skipping ${mix.filter((j) => !out.includes(j)).map((j) => j.name).join(', ')}`)
  }
  if (!out.length) throw new Error('no journeys to run')
  return out
}

export function pickWeighted(mix: Weighted[]): Weighted {
  const total = mix.reduce((sum, j) => sum + j.weight, 0)
  let r = Math.random() * total
  for (const j of mix) {
    r -= j.weight
    if (r < 0) return j
  }
  return mix[mix.length - 1]
}

export function runOne(ctx: Ctx, mix: Weighted[]): void {
  const journey = pickWeighted(mix)
  const started = Date.now()
  try {
    journey.run(ctx)
  } finally {
    journeyDuration.add(Date.now() - started, { journey: journey.name })
    journeys.add(1, { journey: journey.name })
  }
}
