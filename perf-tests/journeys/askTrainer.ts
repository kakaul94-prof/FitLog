// Ask the trainer (POST /api/trainer, a Cloudflare Pages Function). The
// function checks the sign-in against GoTrue, builds the prompt and streams
// Claude's answer; here Claude is the testkit's recording stub, so the call
// costs nothing and what is measured is our own overhead, as time-to-first-byte
// (the user sees the answer start). Runs only when FITLOG_FUNCTIONS_URL is set.
import http from 'k6/http'
import { expectStatus } from '../lib/checks.ts'
import type { Env } from '../lib/env.ts'
import { pick } from '../lib/ids.ts'
import { tagsFor, type Scope } from '../lib/rest.ts'
import { think } from '../lib/think.ts'
import type { Ctx } from '../lib/users.ts'

const QUESTIONS = [
  'How should I progress my squat over the next month?',
  'My bench has stalled at 185 for three weeks. What would you change?',
  'Is my protein intake enough for what I am lifting?',
  'My left shoulder niggles on overhead press. What should I do this week?',
  'Which lift should I prioritise given my goals?',
]

// A snapshot in the shape trainerContext.ts builds (about 1.5 KB; the function
// accepts up to 12,000 characters).
const CONTEXT = [
  'Goals: lose 0.5 lb/week, keep strength. Calorie goal 2,100 kcal/day; adaptive TDEE 2,650 kcal.',
  'Intake, last 14 days: 2,180 kcal/day average, protein 168 g/day (0.9 g/lb).',
  'Weight: 186.4 lb, 7-day average 186.9 lb, down 2.1 lb over 30 days.',
  'Program: Push / Pull / Legs rotation, 4 sessions/week, next up: Pull.',
  'Recent lifts (best set, est. 1RM):',
  '- Back Squat: 225 lb × 5 (253 lb), +10 lb over 4 weeks, 12 sessions',
  '- Bench Press: 185 lb × 5 (208 lb), flat for 3 weeks, 11 sessions',
  '- Deadlift: 315 lb × 3 (346 lb), +15 lb over 4 weeks, 8 sessions',
  '- Overhead Press: 115 lb × 5 (129 lb), +5 lb over 4 weeks, 10 sessions',
  '- Barbell Row: 155 lb × 8 (196 lb), +10 lb over 4 weeks, 10 sessions',
  'Weekly sets by muscle: chest 14, back 16, quads 12, hamstrings 9, shoulders 10, arms 8.',
  'Pain flags (last 14 days): left shoulder on Overhead Press (2 sets, mild).',
  'Open injuries: none. Cardio: 2 sessions/week, 35 min average, zone 2.',
  'Micronutrients under 70% DV this week: vitamin D (41%), magnesium (62%), potassium (58%).',
].join('\n')

/** One question to the trainer as `accessToken`'s user. */
export function askTrainerOnce(env: Env, accessToken: string, scope: Scope = 'journey') {
  const body = { messages: [{ role: 'user', content: pick(QUESTIONS) }], context: CONTEXT, memory: [] }
  return http.post(`${env.functionsUrl}/api/trainer`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    tags: tagsFor('fn.trainer', scope),
    timeout: '60s',
  })
}

export function askTrainer(ctx: Ctx): void {
  if (!ctx.env.functionsUrl) return
  expectStatus(askTrainerOnce(ctx.env, ctx.session.accessToken), 'fn.trainer', 200)
  think(5, 15) // reading the answer
}
