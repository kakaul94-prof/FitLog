// Log a meal: open the food picker (history, library and saved meals load
// together), type a search (the picker queries on every keystroke, so two
// progressively longer searches), pick a result, choose a serving, log it, and
// see the diary refetch the day and the streak.
import { expectRows, expectStatus } from '../lib/checks.ts'
import { addDaysISO } from '../lib/date.ts'
import { between, pick, uuid } from '../lib/ids.ts'
import { batch, rest, type Row } from '../lib/rest.ts'
import type { SeededFood } from '../lib/seed.ts'
import { think } from '../lib/think.ts'
import type { Ctx } from '../lib/users.ts'

// Each matches at least one name in lib/seed.ts FOODS.
const SEARCH_TERMS = ['chicken', 'rice', 'egg', 'yogurt', 'oat', 'banana', 'salmon', 'bread', 'cheese', 'bean', 'berr', 'potato', 'protein', 'pizza', 'coffee']
const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks']

export function logMeal(ctx: Ctx): void {
  const r = rest(ctx.caller)
  const today = ctx.today

  const [history, library, meals] = batch([
    r.from('diary_entries').select('food_id,created_at,servings,serving_qty,serving_unit').gte('entry_date', addDaysISO(today, -60)).not('food_id', 'is', null).order('created_at', { ascending: false }).limit(500).prepare('GET', 'foods.history'),
    r.from('foods').select('*').eq('archived', false).order('updated_at', { ascending: false }).limit(50).prepare('GET', 'foods.list'),
    r.from('meals').select('*').prepare('GET', 'meals.list'),
  ])
  expectRows(history, 'foods.history', 1)
  expectRows(library, 'foods.list', 1)
  expectStatus(meals, 'meals.list')
  think(1.5, 3) // reaching for the search box

  const term = pick(SEARCH_TERMS)
  const search = (text: string) =>
    r.from('foods').select('*').eq('archived', false).ilike('name', `%${text}%`).order('updated_at', { ascending: false }).limit(50).get('foods.search')
  expectRows(search(term.slice(0, 3)), 'foods.search', 1)
  think(0.4, 1.2) // the next keystrokes
  const results = expectRows<SeededFood>(search(term), 'foods.search', 1)
  think(2, 5) // choosing one and setting the serving

  const rows: Row[] = []
  for (let i = between(1, 2); i > 0 && results.length; i--) {
    const food = pick(results)
    // useDiary's newDiaryRow: a client id + created_at so the optimistic row == the synced row.
    rows.push({
      id: uuid(),
      created_at: new Date().toISOString(),
      entry_date: today,
      meal: pick(MEALS),
      food_id: food.id,
      food_name: food.name,
      brand: food.brand,
      servings: pick([0.5, 1, 1, 1.5, 2]),
      serving_qty: food.serving_qty,
      serving_unit: food.serving_unit,
      nutrients: food.nutrients,
    })
  }
  if (rows.length) expectStatus(r.from('diary_entries').insert(rows, 'diary.insert'), 'diary.insert', 201)
  think(0.3, 0.8)

  // The diary invalidates and refetches the day and the streak after a log.
  const [day, streak] = batch([
    r.from('diary_entries').select('*').eq('entry_date', today).order('created_at').prepare('GET', 'diary.day'),
    r.from('diary_entries').select('entry_date').gte('entry_date', addDaysISO(today, -800)).lte('entry_date', today).order('entry_date', { ascending: false }).limit(1000).prepare('GET', 'diary.streak'),
  ])
  expectRows(day, 'diary.day', 1)
  expectRows(streak, 'diary.streak', 1)
  think(2, 5)
}
