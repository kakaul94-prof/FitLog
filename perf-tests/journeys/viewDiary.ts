// Open the Diary tab. DiaryPage fires five queries together (today's entries
// and cardio, the profile, the latest weigh-in and the streak scan), then the
// user reads their totals for a while.
import { expectRows, expectStatus } from '../lib/checks.ts'
import { addDaysISO } from '../lib/date.ts'
import { batch, rest } from '../lib/rest.ts'
import { think } from '../lib/think.ts'
import type { Ctx } from '../lib/users.ts'

export function viewDiary(ctx: Ctx): void {
  const r = rest(ctx.caller)
  const today = ctx.today
  const [day, cardio, profile, weight, streak] = batch([
    r.from('diary_entries').select('*').eq('entry_date', today).order('created_at').prepare('GET', 'diary.day'),
    r.from('exercise_entries').select('*').eq('entry_date', today).order('created_at').prepare('GET', 'exercise.day'),
    r.from('profiles').select('*').prepare('GET', 'profile.get'),
    r.from('measurements').select('value').eq('type', 'weight').order('measured_on', { ascending: false }).limit(1).prepare('GET', 'weight.latest'),
    // useStreak: the first (and, under 1000 logged rows, only) page of dates.
    r.from('diary_entries').select('entry_date').gte('entry_date', addDaysISO(today, -800)).lte('entry_date', today).order('entry_date', { ascending: false }).limit(1000).prepare('GET', 'diary.streak'),
  ])
  expectRows(day, 'diary.day', 1)
  expectStatus(cardio, 'exercise.day')
  expectRows(profile, 'profile.get', 1)
  expectRows(weight, 'weight.latest', 1)
  expectRows(streak, 'diary.streak', 1)
  think(3, 8) // reading today's totals
}
