import type { SupabaseClient } from '@supabase/supabase-js'

// Test data goes in through the API (fast, exact), and the journey under test
// goes through the UI. Every name carries a runId, so tests never see each
// other's rows and can run in parallel or be rerun against the same database.

export interface SeededFood {
  id: string
  name: string
  nutrients: { kcal: number }
}

/** Today as the app computes it (local date). Browser and tests share a machine and time zone. */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add a food to the signed-in user's library: 1 serving = `kcal` calories. */
export async function createFood(db: SupabaseClient, name: string, kcal: number): Promise<SeededFood> {
  const { data, error } = await db
    .from('foods')
    .insert({ name, nutrients: { kcal }, serving_qty: 1, serving_unit: 'serving' })
    .select('id, name, nutrients')
    .single()
  if (error) throw new Error(`createFood(${name}): ${error.message}`)
  return data as SeededFood
}

/** Log a library food to today's snacks the way the app does (nutrients snapshotted per serving). */
export async function logFood(db: SupabaseClient, food: SeededFood): Promise<void> {
  const { error } = await db.from('diary_entries').insert({
    entry_date: todayISO(),
    meal: 'snacks',
    food_id: food.id,
    food_name: food.name,
    nutrients: food.nutrients,
    servings: 1,
    serving_qty: 1,
    serving_unit: 'serving',
  })
  if (error) throw new Error(`logFood(${food.name}): ${error.message}`)
}

/** What actually reached the diary for a food name: the source of truth for "it was saved". */
export async function diaryEntries(db: SupabaseClient, foodName: string) {
  const { data } = await db.from('diary_entries').select('meal, servings, food_id, nutrients').eq('food_name', foodName)
  return data
}
