import type { SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from '../fixtures'
import type { Backup } from '../pages/BackupPage'
import { signedInClient } from '../support/api'
import { addWeighIn, createFood, createRecipe, diaryDay, logFood, logStrengthWorkout, weighIns, wipeAccount } from '../support/data'
import { authFile, USERS } from '../support/env'

// Export and restore, as Grace. Restoring replaces her whole account, so she
// has it to herself and these tests run one at a time. Each starts from the
// same small but linked data set: foods, a recipe built from them, diary
// entries, a workout with sets, a weigh-in.
test.use({ storageState: authFile('grace') })
test.describe.configure({ mode: 'default' })

const grace = USERS.grace.id
const DAY = '2025-04-01'

// The backup format is a contract: a restore on another device depends on it.
const TABLES = [
  'profiles', 'foods', 'recipe_ingredients', 'diary_entries', 'meals', 'meal_items',
  'custom_activities', 'exercise_entries', 'custom_exercises', 'exercise_notes', 'strength_goals',
  'routines', 'routine_exercises', 'workouts', 'workout_exercises', 'workout_sets', 'measurements',
]

type Row = Record<string, unknown>
const rows = (backup: Backup, table: string) => backup[table] as Row[]
const foodNames = async (db: SupabaseClient) => (await diaryDay(db, DAY)).map((e) => e.food_name)

let oatsId = ''
let porridgeId = ''

test.beforeEach(async ({ graceDb }) => {
  await wipeAccount(graceDb)
  const oats = await createFood(graceDb, 'E2E Oats', 150)
  const milk = await createFood(graceDb, 'E2E Milk', 100)
  const porridge = await createRecipe(graceDb, 'E2E Porridge', 2, [oats, milk])
  await logFood(graceDb, oats, { date: DAY, meal: 'breakfast' })
  await logFood(graceDb, porridge, { date: DAY, meal: 'breakfast' })
  await logStrengthWorkout(graceDb, {
    name: 'E2E Push',
    exercise: { key: 'bench_press', name: 'Bench Press' },
    sets: [{ weightLb: 135, reps: 5 }, { weightLb: 135, reps: 5 }],
  })
  await addWeighIn(graceDb, DAY, 140)
  oatsId = oats.id
  porridgeId = porridge.id
})

test.describe('export', () => {
  test('downloads a FitLog backup with every table and your data', async ({ backupPage: backup }) => {
    const file = await backup.exportBackup()

    expect(file.app).toBe('FitLog')
    for (const table of TABLES) expect(Array.isArray(file[table]), table).toBe(true)
    expect(rows(file, 'diary_entries').map((r) => r.food_name).sort()).toEqual(['E2E Oats', 'E2E Porridge'])
    expect(rows(file, 'recipe_ingredients')).toHaveLength(2)
    expect(rows(file, 'workout_sets')).toHaveLength(2)
    expect(rows(file, 'measurements')).toHaveLength(1)
  })

  test('contains only your own data', async ({ backupPage: backup }) => {
    const file = await backup.exportBackup()

    expect(rows(file, 'profiles').map((r) => r.id)).toEqual([grace])
    for (const table of TABLES.filter((t) => t !== 'profiles')) {
      for (const row of rows(file, table)) if ('user_id' in row) expect(row.user_id, table).toBe(grace)
    }
    expect(JSON.stringify(file)).not.toContain("Bob's private sandwich")
  })
})

test.describe('restore', () => {
  test('round trip: changes made after the export are undone', async ({ graceDb, backupPage: backup, diaryPage: diary }) => {
    const file = await backup.exportBackup()
    await graceDb.from('diary_entries').delete().eq('food_name', 'E2E Oats')
    await graceDb.from('foods').update({ nutrients: { kcal: 999 } }).eq('id', oatsId)
    await addWeighIn(graceDb, '2025-04-02', 145)

    await backup.restore(file)

    expect(await foodNames(graceDb)).toEqual(['E2E Oats', 'E2E Porridge'])
    const { data: oats } = await graceDb.from('foods').select('nutrients').eq('id', oatsId).single()
    expect(oats?.nutrients).toEqual({ kcal: 150 })
    expect(await weighIns(graceDb)).toEqual([{ measured_on: DAY, value: 140 }])
    await diary.gotoDate(DAY)
    await expect(diary.entryRow('E2E Oats', 150)).toBeVisible()
  })

  test('the preview counts what will be restored, and Cancel changes nothing', async ({ graceDb, backupPage: backup }) => {
    const file = await backup.exportBackup()

    await backup.chooseFile(JSON.stringify(file))
    await expect(backup.previewRow('diary entries')).toContainText('2')
    await expect(backup.previewRow('workouts')).toContainText('1')
    await backup.cancelButton.click()

    await expect(backup.replaceButton).toBeHidden()
    expect(await foodNames(graceDb)).toEqual(['E2E Oats', 'E2E Porridge'])
  })

  test('keeps links intact: recipe → ingredients, workout → exercises → sets', async ({ graceDb, backupPage: backup }) => {
    await backup.restore(await backup.exportBackup())

    const { data: ingredients } = await graceDb
      .from('recipe_ingredients')
      .select('ingredient:foods!ingredient_food_id(name)')
      .eq('recipe_food_id', porridgeId)
    expect(ingredients!.map((i) => (i.ingredient as unknown as { name: string }).name).sort()).toEqual(['E2E Milk', 'E2E Oats'])
    const { data: workouts } = await graceDb
      .from('workouts')
      .select('name, workout_exercises(exercise_name, workout_sets(reps, weight_lb))')
    expect(workouts).toEqual([
      {
        name: 'E2E Push',
        workout_exercises: [
          { exercise_name: 'Bench Press', workout_sets: [{ reps: 5, weight_lb: 135 }, { reps: 5, weight_lb: 135 }] },
        ],
      },
    ])
  })

  test('rows stamped with another user are restored as your own', async ({ graceDb, backupPage: backup }) => {
    const file = await backup.exportBackup()
    const bob = USERS.bob.id
    const forged = JSON.parse(JSON.stringify(file), (key, value) => (key === 'user_id' ? bob : value)) as Backup

    await backup.restore(forged)

    const { data: entries } = await graceDb.from('diary_entries').select('user_id')
    expect(entries!.map((e) => e.user_id)).toEqual([grace, grace])
    const bobDb = await signedInClient(USERS.bob)
    const { data: bobsDiary } = await bobDb.from('diary_entries').select('food_name')
    expect(bobsDiary).toEqual([{ food_name: "Bob's private sandwich" }]) // nothing landed in Bob's account
  })

  test('replaces rather than merges: anything added after the export is gone', async ({ graceDb, backupPage: backup }) => {
    const file = await backup.exportBackup()
    const late = await createFood(graceDb, 'E2E Late snack', 300)
    await logFood(graceDb, late, { date: DAY })

    await backup.restore(file)

    expect(await foodNames(graceDb)).toEqual(['E2E Oats', 'E2E Porridge'])
    const { data: foods } = await graceDb.from('foods').select('id').eq('name', 'E2E Late snack')
    expect(foods).toEqual([])
  })
})

test.describe('rejects files that are not a backup', () => {
  const cases = [
    { what: 'not JSON at all', contents: 'just some notes', message: 'That file isn’t valid JSON.' },
    {
      what: 'JSON from another app',
      contents: JSON.stringify({ app: 'OtherApp', foods: [] }),
      message: 'That doesn’t look like a FitLog backup.',
    },
    {
      what: 'a FitLog file with no data in it',
      contents: JSON.stringify({ app: 'FitLog', exported_at: '2026-01-01T00:00:00Z' }),
      message: 'Backup contains no recognizable data.',
    },
  ]
  for (const { what, contents, message } of cases) {
    test(what, async ({ graceDb, backupPage: backup }) => {
      await backup.chooseFile(contents)

      await expect(backup.message(message)).toBeVisible()
      await expect(backup.replaceButton).toBeHidden()
      expect(await foodNames(graceDb)).toEqual(['E2E Oats', 'E2E Porridge'])
    })
  }
})
