import { expect, runId, test } from '../fixtures'
import { createRoutine, getProgram, logRoutineWorkout, setProgram } from '../support/data'
import { authFile, USERS } from '../support/env'

// The program (workout rotation) is one record per user, so this spec runs as
// Carol, its tests run one at a time (they share her record), and each test
// starts from a known program set through the API.
test.use({ storageState: authFile('carol') })
test.describe.configure({ mode: 'default' })

const carol = USERS.carol.id
const slot = (routineId: string, id = routineId) => ({ id, kind: 'routine' as const, routineId })
const anExercise = [{ key: 'bench_press', name: 'Bench Press', sets: 3, reps: 8 }]

test.beforeEach(async ({ carolDb }) => {
  await setProgram(carolDb, carol, null)
})

test('picking a ready-made program builds its rotation and keeps your own templates', async ({
  carolDb,
  programPage,
}) => {
  const own = await createRoutine(carolDb, `E2E Carol's own ${runId()}`, anExercise)

  await programPage.choosePreset('Upper / lower')

  for (const day of ['Upper A', 'Lower A', 'Upper B', 'Lower B']) {
    await expect(programPage.slotOptions(day)).toBeVisible()
  }
  const program = await getProgram(carolDb, carol)
  expect(program.activeId).toBe('upper_lower')
  const ids = program.sequence.filter((s: { kind: string }) => s.kind === 'routine').map((s: { routineId: string }) => s.routineId)
  const { data: templates } = await carolDb.from('routines').select('name').in('id', ids)
  expect(templates!.map((t) => t.name).sort()).toEqual(['Lower A', 'Lower B', 'Upper A', 'Upper B'])
  const { data: stillThere } = await carolDb.from('routines').select('id').eq('id', own.id)
  expect(stillThere).toHaveLength(1)
})

test('Next up follows the rotation, skips rest days and wraps around', async ({ carolDb, workoutPage, page }) => {
  const id = runId()
  const a = await createRoutine(carolDb, `E2E Day A ${id}`, anExercise)
  const b = await createRoutine(carolDb, `E2E Day B ${id}`, anExercise)
  await setProgram(carolDb, carol, { sequence: [slot(a.id), { id: 'rest', kind: 'rest' }, slot(b.id)] })

  await workoutPage.goto()
  await expect(workoutPage.nextUp(a.name)).toBeVisible()

  await logRoutineWorkout(carolDb, a)
  await page.reload()
  await expect(workoutPage.nextUp(b.name)).toBeVisible() // the rest day is never "next"

  await logRoutineWorkout(carolDb, b)
  await page.reload()
  await expect(workoutPage.nextUp(a.name)).toBeVisible()
})

test('"Set as next" sticks and keeps the rest of the program record', async ({
  carolDb,
  programPage,
  workoutPage,
}) => {
  const id = runId()
  const a = await createRoutine(carolDb, `E2E Day A ${id}`, anExercise)
  const b = await createRoutine(carolDb, `E2E Day B ${id}`, anExercise)
  const mobility = { stretches: [{ id: `s-${id}`, name: `E2E Hip flexor ${id}`, targetMin: 30 }], log: [] }
  await setProgram(carolDb, carol, { sequence: [slot(a.id), slot(b.id)], mobility })

  await programPage.goto()
  await programPage.setAsNext(b.name)

  await workoutPage.goto()
  await expect(workoutPage.nextUp(b.name)).toBeVisible()
  const program = await getProgram(carolDb, carol)
  expect(program.nextOverride).toMatchObject({ routineId: b.id })
  // Regression: rotation edits once rebuilt this record from scratch and
  // silently dropped the mobility list stored beside the rotation.
  expect(program.mobility).toEqual(mobility)
})

test('switching programs and back restores the original rotation', async ({ carolDb, programPage }) => {
  await programPage.choosePreset('Upper / lower')
  const original = (await getProgram(carolDb, carol)).sequence

  await programPage.choosePreset('Push / pull / legs')
  expect((await getProgram(carolDb, carol)).activeId).toBe('ppl')

  await programPage.choosePreset('Upper / lower')
  const restored = await getProgram(carolDb, carol)
  expect(restored.activeId).toBe('upper_lower')
  expect(restored.sequence).toEqual(original) // the same templates, not a fresh copy
})
