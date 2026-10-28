// promptfoo test generator for the judge's calibration set: the 15 replies in
// ai-evals/calibration/responses.yaml that the app owner labelled pass or fail
// by hand (calibration/labels.yaml). Each is replayed as stored (provider mode
// "replay") and graded by llm-rubric under its rubric, so promptfoo's grader
// can be scored against the same labels as the custom judge
// (python -m aievals.crossjudge). The labels are not shown to either grader.
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { AI_EVALS } from './lib/contexts.mjs'
import { rubricAssertion } from './tests.mjs'

export default async function generate() {
  const items = yaml.load(readFileSync(`${AI_EVALS}calibration/responses.yaml`, 'utf8'))
  return items.map((item) => ({
    description: `${item.id}: ${item.rubric} (${item.source})`,
    vars: { case_id: item.id, ask: item.question, reply: item.reply, judge_log: item.log ?? '' },
    assert: [rubricAssertion(item.rubric)],
    metadata: { item: item.id, rubric: item.rubric, source: item.source },
  }))
}
