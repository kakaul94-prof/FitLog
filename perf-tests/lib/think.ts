// Think time: the pauses a real person leaves between actions (reading the
// diary, typing a search, resting between sets). Scaled per scenario
// (config/profiles.ts) or with THINK_SCALE=…; 0 removes every pause, which
// turns a journey into a hammer — handy for a quick check, not a measurement.
import { sleep } from 'k6'

let scale = 1

export function setThinkScale(value: number): void {
  scale = value
}

/** Pause for a uniformly random time between `minS` and `maxS` seconds, scaled. */
export function think(minS: number, maxS: number): void {
  const seconds = (minS + Math.random() * (maxS - minS)) * scale
  if (seconds > 0) sleep(seconds)
}
