// promptfoo test generator that replays the custom suite's own live runs:
// every raw reply in reports/ai-evals-live/<run>/results.jsonl, scored by
// promptfoo's rule assertions (no model is called, nothing is spent). Run
// `npm run eval:pf:compare` on the result and checks.py scores the same
// replies, so the two implementations of every rule check are compared on
// real model output, not only on hand-written replies.
//
// PF_REPLAY_RUNS is a JSON array of run directories (run.mjs sets it).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCases, ruleAssertions } from './tests.mjs'

export default async function generate() {
  const runs = JSON.parse(process.env.PF_REPLAY_RUNS ?? '[]')
  if (!runs.length) throw new Error('PF_REPLAY_RUNS names no live run to replay')
  const cases = new Map(loadCases().map((c) => [c.id, c]))
  const tests = []
  for (const dir of runs) {
    const rulesFile = join(dir, 'prompt_rules.txt')
    if (!existsSync(rulesFile)) throw new Error(`${dir} has no prompt_rules.txt`)
    const rows = readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    for (const row of rows) {
      const c = cases.get(row.case)
      if (!c) continue // a case removed from the dataset since the run
      const assert = ruleAssertions(c.expect)
      if (!assert.length) continue // judged only: nothing for the rule checks to compare
      tests.push({
        description: `${row.case} run ${row.rep} (${dir.split(/[\\/]/).pop()})`,
        vars: { case_id: row.case, ask: row.ask, reply: row.reply, reply_kind: 'raw', rules_file: rulesFile },
        assert,
        metadata: { case_id: row.case, category: c.category, kind: c.kind, rep: String(row.rep) },
      })
    }
  }
  return tests
}
