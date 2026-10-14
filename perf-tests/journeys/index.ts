// The traffic mix. Weights are relative: a day in the app is mostly opening the
// diary and logging food, with a workout most days, a weigh-in most mornings
// and the odd question for the trainer. To add a journey, write a function that
// takes a `Ctx` (see any file here) and add one line below; to give a scenario
// a different mix, pass it a different array (scenarios/*.ts).
import type { Weighted } from '../lib/mix.ts'
import { askTrainer } from './askTrainer.ts'
import { logMeal } from './logMeal.ts'
import { logWeight } from './logWeight.ts'
import { logWorkout } from './logWorkout.ts'
import { viewDiary } from './viewDiary.ts'

export const REALISTIC_MIX: Weighted[] = [
  { name: 'viewDiary', weight: 35, run: viewDiary },
  { name: 'logMeal', weight: 30, run: logMeal },
  { name: 'logWorkout', weight: 20, run: logWorkout },
  { name: 'logWeight', weight: 10, run: logWeight },
  { name: 'askTrainer', weight: 5, run: askTrainer, needs: 'functions' },
]
