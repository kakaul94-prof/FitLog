// Per-run users and their history. A fresh user with an empty diary would make
// every query trivially fast, so each seeded user gets `seedDays` of realistic
// use: ~150 foods, ~10 diary rows a day, a workout every other day (4 lifts ×
// 3 sets), a daily weigh-in and cardio twice a week. 90 days (the load, stress
// and soak default) is a committed user; the smoke run seeds two weeks.
//
// Everything is written as the service role with an explicit `user_id`, in
// bulk, so seeding 30 users takes seconds rather than minutes. The users are
// named `perf-<run>-<n>@perf.test`; deleting a user cascades to every row they
// own (setup → teardown), and run.sh sweeps that domain afterwards in case a
// run was stopped before teardown.
import type { Profile } from '../config/profiles.ts'
import { adminInsert, createUsers, deleteUser, type CreatedUser } from './admin.ts'
import { addDaysISO, at, todayISO } from './date.ts'
import type { Env } from './env.ts'
import { between, pick, randomId } from './ids.ts'
import type { Row } from './rest.ts'

export const PERF_EMAIL_DOMAIN = '@perf.test'

export interface PoolUser {
  id: string
  email: string
  password: string
}

/** What setup() hands every VU. Tokens are not in it: each VU signs in itself. */
export interface SetupData {
  runId: string
  users: PoolUser[]
  seedDays: number
  seededAt: string
  setupMs: number
  rows: Record<string, number>
  /** When the VUs start (ms since epoch): the phase clock (lib/phase.ts). */
  runStartedAt: number
}

// name, kcal, protein, carbs, fat, serving unit. The search terms the logMeal
// journey types (journeys/logMeal.ts) all match names here.
type FoodSpec = readonly [string, number, number, number, number, string]
export const FOODS: readonly FoodSpec[] = [
  ['Chicken breast, grilled', 165, 31, 0, 3.6, '100 g'],
  ['Chicken thigh, roasted', 209, 26, 0, 11, '100 g'],
  ['Chicken caesar salad', 470, 36, 12, 30, 'bowl'],
  ['Brown rice, cooked', 112, 2.3, 24, 0.8, 'cup'],
  ['White rice, cooked', 130, 2.7, 28, 0.3, 'cup'],
  ['Egg, large', 72, 6.3, 0.4, 4.8, 'egg'],
  ['Egg whites', 52, 11, 0.7, 0.2, 'cup'],
  ['Greek yogurt, plain', 100, 17, 6, 0.7, 'cup'],
  ['Oats, rolled', 150, 5, 27, 2.5, '40 g'],
  ['Oatmeal with berries', 260, 8, 48, 4, 'bowl'],
  ['Banana', 105, 1.3, 27, 0.4, 'medium'],
  ['Apple', 95, 0.5, 25, 0.3, 'medium'],
  ['Salmon, baked', 206, 22, 0, 12, '100 g'],
  ['Tuna, canned in water', 116, 26, 0, 1, 'can'],
  ['Whole wheat bread', 80, 4, 14, 1, 'slice'],
  ['Sourdough bread', 90, 3.5, 17, 0.5, 'slice'],
  ['Cheddar cheese', 113, 7, 0.4, 9, 'oz'],
  ['Cottage cheese', 206, 23, 8, 9, 'cup'],
  ['Peanut butter', 190, 7, 7, 16, '2 tbsp'],
  ['Almonds', 164, 6, 6, 14, 'oz'],
  ['Whey protein', 120, 24, 3, 1.5, 'scoop'],
  ['Protein bar', 210, 20, 23, 7, 'bar'],
  ['Milk, 2%', 122, 8, 12, 5, 'cup'],
  ['Broccoli, steamed', 55, 3.7, 11, 0.6, 'cup'],
  ['Spinach, raw', 7, 0.9, 1, 0.1, 'cup'],
  ['Sweet potato, baked', 103, 2.3, 24, 0.1, 'medium'],
  ['Potato, baked', 161, 4.3, 37, 0.2, 'medium'],
  ['Avocado', 240, 3, 13, 22, 'fruit'],
  ['Olive oil', 119, 0, 0, 13.5, 'tbsp'],
  ['Ground beef, 90% lean', 184, 23, 0, 10, '4 oz'],
  ['Steak, sirloin', 207, 29, 0, 9, '4 oz'],
  ['Pork chop', 231, 27, 0, 13, '4 oz'],
  ['Turkey breast, deli', 104, 17, 4, 2, '3 oz'],
  ['Shrimp', 99, 24, 0.3, 0.3, '100 g'],
  ['Tofu, firm', 144, 17, 3, 9, '100 g'],
  ['Black beans', 227, 15, 41, 1, 'cup'],
  ['Chickpeas', 269, 15, 45, 4, 'cup'],
  ['Lentils, cooked', 230, 18, 40, 0.8, 'cup'],
  ['Quinoa, cooked', 222, 8, 39, 3.6, 'cup'],
  ['Pasta, cooked', 220, 8, 43, 1.3, 'cup'],
  ['Tortilla, flour', 140, 4, 24, 3.5, 'tortilla'],
  ['Bagel', 289, 11, 56, 1.7, 'bagel'],
  ['Granola', 200, 5, 30, 7, '½ cup'],
  ['Blueberries', 85, 1.1, 21, 0.5, 'cup'],
  ['Strawberries', 49, 1, 12, 0.5, 'cup'],
  ['Orange', 62, 1.2, 15, 0.2, 'medium'],
  ['Grapes', 104, 1.1, 27, 0.2, 'cup'],
  ['Carrots', 52, 1.2, 12, 0.3, 'cup'],
  ['Hummus', 70, 2, 6, 5, '2 tbsp'],
  ['Dark chocolate', 170, 2, 13, 12, 'oz'],
  ['Ice cream, vanilla', 273, 4.6, 31, 14, 'cup'],
  ['Pizza, cheese', 285, 12, 36, 10, 'slice'],
  ['Burrito, chicken', 580, 32, 68, 18, 'burrito'],
  ['Smoothie, berry', 230, 6, 50, 1.5, '16 oz'],
  ['Coffee with milk', 35, 2, 3, 1.5, 'cup'],
  ['Orange juice', 112, 1.7, 26, 0.5, 'cup'],
  ['Beer', 153, 1.6, 13, 0, '12 oz'],
  ['Red wine', 125, 0.1, 4, 0, '5 oz'],
  ['Butter', 102, 0.1, 0, 11.5, 'tbsp'],
  ['Honey', 64, 0, 17, 0, 'tbsp'],
]
const BRANDS = ['Kirkland', 'Great Value', "Trader Joe's", '365', 'Chobani']

type Lift = readonly [key: string, name: string, weightLb: number]
export const LIFTS: readonly Lift[] = [
  ['back_squat', 'Back Squat', 225],
  ['bench_press', 'Bench Press', 185],
  ['deadlift', 'Deadlift', 315],
  ['overhead_press', 'Overhead Press', 115],
  ['barbell_row', 'Barbell Row', 155],
  ['romanian_deadlift', 'Romanian Deadlift', 205],
  ['incline_dumbbell_press', 'Incline Dumbbell Press', 70],
  ['pull_up', 'Pull-up', 0],
]
const CARDIO = ['Running', 'Walking', 'Cycling', 'Elliptical']
const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const
const MEAL_HOUR: Record<(typeof MEALS)[number], number> = { breakfast: 8, lunch: 12, snacks: 15, dinner: 19 }

export interface SeededFood {
  id: string
  name: string
  brand: string | null
  serving_qty: number
  serving_unit: string
  nutrients: Record<string, number>
}

function foodRow(userId: string, spec: FoodSpec, brand: string | null, when: string): Row {
  const [name, kcal, protein, carbs, fat, unit] = spec
  return {
    user_id: userId,
    name,
    brand,
    source: 'manual',
    serving_qty: 1,
    serving_unit: unit,
    nutrients: { kcal, protein, carbs, fat },
    archived: false,
    created_at: when,
    updated_at: when,
  }
}

/** The app's diary row from a food (useDiary.ts newDiaryRow), minus the client id. */
export function diaryRow(userId: string, food: SeededFood, entryDate: string, meal: string, servings: number, createdAt: string, position: number): Row {
  return {
    user_id: userId,
    entry_date: entryDate,
    meal,
    food_id: food.id,
    food_name: food.name,
    brand: food.brand,
    servings,
    serving_qty: food.serving_qty,
    serving_unit: food.serving_unit,
    nutrients: food.nutrients,
    position,
    created_at: createdAt,
  }
}

export function seedPool(env: Env, profile: Profile): SetupData {
  const started = Date.now()
  const runId = `${Date.now().toString(36)}${randomId(4)}`
  const credentials = Array.from({ length: profile.pool }, (_, i) => ({
    email: `perf-${runId}-${i + 1}${PERF_EMAIL_DOMAIN}`,
    password: `pw-${randomId(12)}`,
  }))
  const users = createUsers(env, credentials)
  const rows = seedHistory(env, users, profile.seedDays)
  return {
    runId,
    users: users.map(({ id, email, password }) => ({ id, email, password })),
    seedDays: profile.seedDays,
    seededAt: new Date().toISOString(),
    setupMs: Date.now() - started,
    rows,
    runStartedAt: Date.now(), // the scenario resets this after its pre-flight
  }
}

function seedHistory(env: Env, users: CreatedUser[], days: number): Record<string, number> {
  const today = todayISO()
  const day = (offset: number) => addDaysISO(today, -offset)
  const counts: Record<string, number> = {}
  const insert = (table: string, rows: Row[], select?: string): Row[] => {
    counts[table] = (counts[table] ?? 0) + rows.length
    return rows.length ? adminInsert(env, table, rows, select) : []
  }

  // Foods: every spec plus one or two branded copies, ~150 per user, dated
  // across the history so `order by updated_at desc` has something to sort.
  const foodRows: Row[] = []
  const foodOwner: number[] = []
  users.forEach((u, ui) => {
    FOODS.forEach((spec, i) => {
      const variants: (string | null)[] = [null, BRANDS[i % BRANDS.length]]
      if (i % 2 === 0) variants.push(BRANDS[(i + 1) % BRANDS.length])
      for (const brand of variants) {
        foodRows.push(foodRow(u.id, spec, brand, at(day(between(0, days - 1)), between(6, 21), between(0, 59))))
        foodOwner.push(ui)
      }
    })
  })
  const foodIds = insert('foods', foodRows, 'id').map((r) => r.id as string)
  const foodsOf: SeededFood[][] = users.map(() => [])
  foodRows.forEach((row, i) => {
    foodsOf[foodOwner[i]].push({
      id: foodIds[i],
      name: row.name as string,
      brand: row.brand as string | null,
      serving_qty: row.serving_qty as number,
      serving_unit: row.serving_unit as string,
      nutrients: row.nutrients as Record<string, number>,
    })
  })

  // Diary: 2–3 items per meal, every day.
  const diary: Row[] = []
  users.forEach((u, ui) => {
    for (let d = 0; d < days; d++) {
      const date = day(d)
      let position = 0
      for (const meal of MEALS) {
        const items = between(2, 3)
        for (let i = 0; i < items; i++) {
          diary.push(diaryRow(u.id, pick(foodsOf[ui]), date, meal, pick([0.5, 1, 1, 1.5, 2]), at(date, MEAL_HOUR[meal], i * 3), position++))
        }
      }
    }
  })
  insert('diary_entries', diary)

  // Workouts every other day: 4 lifts × 3 sets, all completed.
  const workouts: Row[] = []
  users.forEach((u) => {
    for (let d = 1; d < days; d += 2) {
      workouts.push({ user_id: u.id, workout_date: day(d), name: pick(['Push', 'Pull', 'Legs', 'Upper', 'Lower']), completed: true, rest_seconds: 90, created_at: at(day(d), 17) })
    }
  })
  const workoutIds = insert('workouts', workouts, 'id').map((r) => r.id as string)
  const exercises: Row[] = []
  const exerciseDate: string[] = [] // the workout's date, per exercise row (sets are timed from it)
  workouts.forEach((w, wi) => {
    const start = between(0, LIFTS.length - 1)
    for (let p = 0; p < 4; p++) {
      const [key, name] = LIFTS[(start + p) % LIFTS.length]
      exercises.push({ user_id: w.user_id, workout_id: workoutIds[wi], exercise_key: key, exercise_name: name, position: p, created_at: at(w.workout_date as string, 17, p * 12) })
      exerciseDate.push(w.workout_date as string)
    }
  })
  const exerciseIds = insert('workout_exercises', exercises, 'id').map((r) => r.id as string)
  const sets: Row[] = []
  exercises.forEach((e, ei) => {
    const base = LIFTS.find((l) => l[0] === e.exercise_key)?.[2] ?? 100
    for (let s = 1; s <= 3; s++) {
      sets.push({
        user_id: e.user_id,
        workout_id: e.workout_id,
        workout_exercise_id: exerciseIds[ei],
        exercise_key: e.exercise_key,
        exercise_name: e.exercise_name,
        set_number: s,
        reps: between(5, 8),
        weight_lb: base ? base - between(0, 3) * 5 : null,
        effort: between(7, 9),
        created_at: at(exerciseDate[ei], 17, (e.position as number) * 12 + s * 3),
      })
    }
  })
  insert('workout_sets', sets)

  // A weigh-in every morning, drifting down slowly with noise.
  const measurements: Row[] = []
  users.forEach((u) => {
    const start = between(150, 220)
    for (let d = 0; d < days; d++) {
      measurements.push({ user_id: u.id, type: 'weight', measured_on: day(d), value: Math.round((start - (days - d) * 0.03 + (Math.random() - 0.5) * 2) * 10) / 10, unit: 'lb', created_at: at(day(d), 7) })
    }
  })
  insert('measurements', measurements)

  // Cardio twice a week.
  const cardio: Row[] = []
  users.forEach((u) => {
    for (let d = 0; d < days; d += 3) {
      cardio.push({ user_id: u.id, entry_date: day(d), name: pick(CARDIO), met: 7, duration_min: between(20, 45), calories: between(150, 450), created_at: at(day(d), 18) })
    }
  })
  insert('exercise_entries', cardio)

  return counts
}

export function deletePool(env: Env, users: PoolUser[]): void {
  let failed = 0
  for (const u of users) {
    const status = deleteUser(env, u.id)
    if (![200, 204, 404].includes(status)) failed++
  }
  if (failed) console.warn(`teardown: ${failed} of ${users.length} users could not be deleted; run.sh sweeps ${PERF_EMAIL_DOMAIN} afterwards`)
}
