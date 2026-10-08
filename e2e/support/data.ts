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

/** A recipe (a food with source 'recipe') built from 1 base serving of each ingredient. */
export async function createRecipe(
  db: SupabaseClient,
  name: string,
  yieldServings: number,
  ingredients: SeededFood[],
): Promise<SeededFood> {
  const total = ingredients.reduce((sum, f) => sum + f.nutrients.kcal, 0)
  const { data: recipe, error } = await db
    .from('foods')
    .insert({
      name,
      source: 'recipe',
      recipe_servings: yieldServings,
      serving_qty: 1,
      serving_unit: 'serving',
      nutrients: { kcal: total / yieldServings }, // what the app would store
    })
    .select('id, name, nutrients')
    .single()
  if (error) throw new Error(`createRecipe(${name}): ${error.message}`)
  const rows = ingredients.map((f, i) => ({
    recipe_food_id: recipe.id,
    ingredient_food_id: f.id,
    amount: 1,
    unit: 'base',
    servings: 1,
    position: i,
  }))
  const { error: ingError } = await db.from('recipe_ingredients').insert(rows)
  if (ingError) throw new Error(`createRecipe(${name}) ingredients: ${ingError.message}`)
  return recipe as SeededFood
}

export async function recipeFood(db: SupabaseClient, id: string) {
  const { data } = await db.from('foods').select('name, source, recipe_servings, nutrients').eq('id', id).single()
  return data
}

export interface SeededRoutine {
  id: string
  name: string
}

/** A workout template with exercises in order (keys from src/data/exercises.ts). */
export async function createRoutine(
  db: SupabaseClient,
  name: string,
  exercises: { key: string; name: string; sets?: number; reps?: number }[],
): Promise<SeededRoutine> {
  const { data: routine, error } = await db.from('routines').insert({ name }).select('id, name').single()
  if (error) throw new Error(`createRoutine(${name}): ${error.message}`)
  if (exercises.length) {
    const { error: exError } = await db.from('routine_exercises').insert(
      exercises.map((e, i) => ({
        routine_id: routine.id,
        exercise_key: e.key,
        exercise_name: e.name,
        position: i,
        target_sets: e.sets ?? null,
        target_reps: e.reps ?? null,
      })),
    )
    if (exError) throw new Error(`createRoutine(${name}) exercises: ${exError.message}`)
  }
  return routine as SeededRoutine
}

/** A template's exercises in order, as saved. */
export async function routineExercises(db: SupabaseClient, routineId: string) {
  const { data } = await db
    .from('routine_exercises')
    .select('exercise_name, target_sets, target_reps')
    .eq('routine_id', routineId)
    .order('position')
  return data
}

/** A completed workout from a template, logged today: what the program's "Next up" reads. */
export async function logRoutineWorkout(db: SupabaseClient, routine: SeededRoutine): Promise<void> {
  const { error } = await db
    .from('workouts')
    .insert({ workout_date: todayISO(), name: routine.name, source_routine_id: routine.id, completed: true })
  if (error) throw new Error(`logRoutineWorkout(${routine.name}): ${error.message}`)
}

/** Replace the user's whole program record (profiles.program); null = no program. */
export async function setProgram(db: SupabaseClient, userId: string, program: object | null): Promise<void> {
  const { error } = await db.from('profiles').update({ program }).eq('id', userId)
  if (error) throw new Error(`setProgram: ${error.message}`)
}

export async function getProgram(db: SupabaseClient, userId: string) {
  const { data } = await db.from('profiles').select('program').eq('id', userId).single()
  return data?.program
}

/** What actually reached the diary for a food name: the source of truth for "it was saved". */
export async function diaryEntries(db: SupabaseClient, foodName: string) {
  const { data } = await db.from('diary_entries').select('meal, servings, food_id, nutrients').eq('food_name', foodName)
  return data
}
