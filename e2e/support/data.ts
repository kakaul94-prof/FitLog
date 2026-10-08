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

/** Log a library food the way the app does (nutrients snapshotted per serving). Default: today's snacks. */
export async function logFood(
  db: SupabaseClient,
  food: SeededFood,
  { date = todayISO(), meal = 'snacks', servings = 1 }: { date?: string; meal?: string; servings?: number } = {},
): Promise<void> {
  const { error } = await db.from('diary_entries').insert({
    entry_date: date,
    meal,
    food_id: food.id,
    food_name: food.name,
    nutrients: food.nutrients,
    servings,
    serving_qty: 1,
    serving_unit: 'serving',
  })
  if (error) throw new Error(`logFood(${food.name}): ${error.message}`)
}

/** Empty a day's food diary, so a test that owns that date starts clean on every run. */
export async function clearDiaryDay(db: SupabaseClient, date: string): Promise<void> {
  const { error } = await db.from('diary_entries').delete().eq('entry_date', date)
  if (error) throw new Error(`clearDiaryDay(${date}): ${error.message}`)
}

/** A day's food diary, as saved. */
export async function diaryDay(db: SupabaseClient, date: string) {
  const { data } = await db.from('diary_entries').select('food_name, meal, servings').eq('entry_date', date).order('food_name')
  return data ?? []
}

export async function addWeighIn(db: SupabaseClient, date: string, lb: number): Promise<void> {
  const { error } = await db.from('measurements').insert({ measured_on: date, type: 'weight', value: lb })
  if (error) throw new Error(`addWeighIn(${lb}): ${error.message}`)
}

export async function weighIns(db: SupabaseClient) {
  const { data } = await db.from('measurements').select('measured_on, value').eq('type', 'weight').order('value')
  return data ?? []
}

/** A strength workout with one exercise and its sets; returns the workout id. */
export async function logStrengthWorkout(
  db: SupabaseClient,
  { name, exercise, sets, completed = true }: {
    name: string
    exercise: { key: string; name: string }
    sets: { weightLb: number; reps: number }[]
    completed?: boolean
  },
): Promise<string> {
  const { data: w, error } = await db
    .from('workouts')
    .insert({ workout_date: todayISO(), name, completed })
    .select('id')
    .single()
  if (error) throw new Error(`logStrengthWorkout: ${error.message}`)
  const { data: we, error: weError } = await db
    .from('workout_exercises')
    .insert({ workout_id: w.id, exercise_key: exercise.key, exercise_name: exercise.name, position: 0 })
    .select('id')
    .single()
  if (weError) throw new Error(`logStrengthWorkout exercise: ${weError.message}`)
  const { error: setError } = await db.from('workout_sets').insert(
    sets.map((s, i) => ({
      workout_id: w.id,
      workout_exercise_id: we.id,
      exercise_key: exercise.key,
      exercise_name: exercise.name,
      set_number: i + 1,
      weight_lb: s.weightLb,
      reps: s.reps,
    })),
  )
  if (setError) throw new Error(`logStrengthWorkout sets: ${setError.message}`)
  return w.id
}

/** Replace the trainer's saved facts (profiles.trainer_memory). */
export async function setTrainerMemory(db: SupabaseClient, userId: string, facts: string[]): Promise<void> {
  const memory = facts.map((text, i) => ({ id: `fact-${i}`, text, created_at: new Date().toISOString() }))
  const { error } = await db.from('profiles').update({ trainer_memory: memory }).eq('id', userId)
  if (error) throw new Error(`setTrainerMemory: ${error.message}`)
}

export async function trainerMemory(db: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await db.from('profiles').select('trainer_memory').eq('id', userId).single()
  return ((data?.trainer_memory ?? []) as { text: string }[]).map((f) => f.text)
}

// Children before parents, so foreign keys never block the wipe. Row-level
// security limits every delete to the signed-in user's own rows.
const WIPE_ORDER = [
  'workout_sets',
  'workout_exercises',
  'workouts',
  'routine_exercises',
  'routines',
  'recipe_ingredients',
  'meal_items',
  'meals',
  'diary_entries',
  'exercise_entries',
  'custom_activities',
  'exercise_notes',
  'strength_goals',
  'custom_exercises',
  'measurements',
  'foods',
]

/** Delete everything the signed-in user owns (except their profile row). */
export async function wipeAccount(db: SupabaseClient): Promise<void> {
  for (const table of WIPE_ORDER) {
    const { error } = await db.from(table).delete().not('id', 'is', null)
    if (error) throw new Error(`wipeAccount(${table}): ${error.message}`)
  }
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

/** Replace the user's whole program record (profiles.program); null = no program. */
export async function setProgram(db: SupabaseClient, userId: string, program: object | null): Promise<void> {
  const { error } = await db.from('profiles').update({ program }).eq('id', userId)
  if (error) throw new Error(`setProgram: ${error.message}`)
}

export async function getProgram(db: SupabaseClient, userId: string) {
  const { data } = await db.from('profiles').select('program').eq('id', userId).single()
  return data?.program
}

/** Empty a day's exercise log, so a test that owns that date starts clean on every run. */
export async function clearExerciseDay(db: SupabaseClient, date: string): Promise<void> {
  const { error } = await db.from('exercise_entries').delete().eq('entry_date', date)
  if (error) throw new Error(`clearExerciseDay(${date}): ${error.message}`)
}

/** A day's exercise entries, as saved. */
export async function exerciseEntries(db: SupabaseClient, date: string) {
  const { data } = await db
    .from('exercise_entries')
    .select('id, name, met, duration_min, distance_mi, calories')
    .eq('entry_date', date)
    .order('created_at')
  return data ?? []
}

/** What actually reached the diary for a food name: the source of truth for "it was saved". */
export async function diaryEntries(db: SupabaseClient, foodName: string) {
  const { data } = await db.from('diary_entries').select('meal, servings, food_id, nutrients').eq('food_name', foodName)
  return data
}

/** A saved meal holding 1 serving of each food (items snapshot the food, like the app's "Save as meal"). */
export async function createMeal(db: SupabaseClient, name: string, foods: SeededFood[]): Promise<string> {
  const { data: meal, error } = await db.from('meals').insert({ name }).select('id').single()
  if (error) throw new Error(`createMeal(${name}): ${error.message}`)
  const { error: itemError } = await db.from('meal_items').insert(
    foods.map((f, i) => ({
      meal_id: meal.id,
      food_id: f.id,
      food_name: f.name,
      servings: 1,
      serving_qty: 1,
      serving_unit: 'serving',
      nutrients: f.nutrients,
      position: i,
    })),
  )
  if (itemError) throw new Error(`createMeal(${name}) items: ${itemError.message}`)
  return meal.id
}

/** A saved meal by name with its items' food names, or null once it's gone. */
export async function savedMeal(db: SupabaseClient, name: string) {
  const { data } = await db.from('meals').select('name, meal_items(food_name, servings)').eq('name', name).maybeSingle()
  if (!data) return null
  return { name: data.name as string, items: (data.meal_items as { food_name: string }[]).map((i) => i.food_name).sort() }
}

/** A food by name, as saved. "Deleting" a food archives it (archived: true). */
export async function foodByName(db: SupabaseClient, name: string) {
  const { data } = await db
    .from('foods')
    .select('id, name, brand, serving_qty, serving_unit, serving_grams, nutrients, portions, archived')
    .eq('name', name)
    .maybeSingle()
  return data
}

/** A day's food diary with each entry's food link (null after its food is deleted). */
export async function diaryLinks(db: SupabaseClient, date: string) {
  const { data } = await db.from('diary_entries').select('food_name, food_id').eq('entry_date', date)
  return data ?? []
}

/** Today (or `offset` days from it) as YYYY-MM-DD, in local time like the app. */
export function dayFromToday(offset: number): string {
  const d = new Date(`${todayISO()}T12:00:00`)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('en-CA')
}
