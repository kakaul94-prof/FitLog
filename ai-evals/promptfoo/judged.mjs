// Assertion transform for the llm-rubric graders: the reply as the user sees
// it, which is what the custom judge grades too (aievals/live.py
// shown_to_judge): the chat bubble's text, plus the "Remember" chip when the
// app's parser would offer one. Both come from the app's own code. A replayed
// calibration reply was stored this way already, and passes through unchanged.
import { loadTrainer } from './lib/bundle.mjs'

export default async function judged(output) {
  const trainer = await loadTrainer()
  const text = trainer.displayText(String(output))
  const chip = trainer.parseRemember(String(output))
  return chip ? `${text}\n\n(The app also offers a "Remember" chip: "${chip}")` : text
}
