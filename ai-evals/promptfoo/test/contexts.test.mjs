// contexts.json's templates render as the app would write them on the run's day.
//   node --test "ai-evals/promptfoo/test/*.test.mjs"
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderContext } from '../lib/contexts.mjs'

test("today's weekday moves with the date (canary.py render_snapshot)", () => {
  assert.equal(renderContext('Today is {{weekday}}, {{today}}.', '2026-11-02'), 'Today is Monday, 2026-11-02.')
  assert.equal(renderContext('Last {{today-2}}, next {{today+1}}', '2026-11-02'), 'Last 2026-10-31, next 2026-11-03')
})
