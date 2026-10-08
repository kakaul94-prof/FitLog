import { expect, test } from '../fixtures'
import { logStrengthWorkout, setTrainerMemory, trainerMemory } from '../support/data'
import { authFile, USERS } from '../support/env'

// Ask-a-trainer, as Frank (200 lb, 2000 cal/day goal: seed.sql). /api/trainer
// is stubbed (support/trainer.ts): replies are scripted, so Claude is never
// called, and each test can check exactly what the app sent. Frank's saved
// memory is one record, so these tests run one at a time.
test.use({ storageState: authFile('frank') })
test.describe.configure({ mode: 'default' })

const frank = USERS.frank.id
const BENCH = { key: 'bench_press', name: 'Bench Press' }

test.beforeEach(async ({ frankDb }) => {
  await setTrainerMemory(frankDb, frank, [])
  await frankDb.from('workouts').delete().eq('completed', false) // no leftover live workout
})

test('answers a question in the chat', async ({ trainer, trainerPage: chat }) => {
  trainer.replies('Add 5 lb a week while your reps hold.')
  await chat.goto()

  await chat.ask('How do I progress my squat?')

  await expect(chat.bubble('How do I progress my squat?')).toBeVisible()
  await expect(chat.bubble('Add 5 lb a week while your reps hold.')).toBeVisible()
})

test('grounds the question in a snapshot of your own log', async ({ frankDb, trainer, trainerPage: chat }) => {
  await logStrengthWorkout(frankDb, { name: 'E2E Push', exercise: BENCH, sets: [{ weightLb: 185, reps: 5 }] })
  trainer.replies('Your bench is moving well.')
  await chat.goto()

  await chat.ask('Is my bench progressing?')
  await expect(chat.bubble('Your bench is moving well.')).toBeVisible()

  const [sent] = trainer.requests
  expect(sent.messages).toEqual([{ role: 'user', content: 'Is my bench progressing?' }])
  expect(sent.context).toContain('200 lb') // "Lifter: …" bio, from the latest weigh-in
  expect(sent.context).toContain('Bench Press')
  expect(sent.context).toContain('Calorie goal: 2000/day')
})

test('a follow-up sends the whole conversation', async ({ trainer, trainerPage: chat }) => {
  trainer.replies('Sleep and protein first.', 'Then add a back-off set.')
  await chat.goto()

  await chat.ask('Why am I stalling?')
  await expect(chat.bubble('Sleep and protein first.')).toBeVisible()
  await chat.ask('And after that?')
  await expect(chat.bubble('Then add a back-off set.')).toBeVisible()

  expect(trainer.requests[1].messages).toEqual([
    { role: 'user', content: 'Why am I stalling?' },
    { role: 'assistant', content: 'Sleep and protein first.' },
    { role: 'user', content: 'And after that?' },
  ])
})

test('a starter prompt asks that question', async ({ trainer, trainerPage: chat }) => {
  trainer.replies('Usually recovery or volume.')
  await chat.goto()

  await chat.starter('Why has my bench stalled?').click()

  await expect(chat.bubble('Usually recovery or volume.')).toBeVisible()
  expect(trainer.requests[0].messages).toEqual([{ role: 'user', content: 'Why has my bench stalled?' }])
})

test('offers to remember a fact, hides the marker, and saves it on request', async ({
  frankDb,
  trainer,
  trainerPage: chat,
  page,
}) => {
  const fact = 'Left knee aches on deep squats'
  trainer.replies(`Keep squats above parallel for now. [[REMEMBER: ${fact}]]`)
  await chat.goto()

  await chat.ask('My knee hurts when I squat deep')
  await expect(chat.bubble('Keep squats above parallel for now.')).toBeVisible()
  await expect(page.getByText('[[REMEMBER')).toHaveCount(0)

  await chat.rememberButton(fact).click()
  await expect(chat.savedToMemory).toBeVisible()
  await expect.poll(() => trainerMemory(frankDb, frank)).toEqual([fact])
  await chat.openMemory()
  await expect(chat.forgetButton(fact)).toBeVisible()
})

test('sends saved facts with the next question', async ({ frankDb, trainer, trainerPage: chat, page }) => {
  await setTrainerMemory(frankDb, frank, ['Prefers dumbbells', 'Trains at 6am'])
  trainer.replies('Noted.')
  // The chat sends whatever memory has loaded, so let the profile arrive first.
  const profile = page.waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.ok())
  await chat.goto()
  await profile

  await chat.ask('Plan my week')
  await expect(chat.bubble('Noted.')).toBeVisible()

  expect(trainer.requests[0].memory).toEqual(['Prefers dumbbells', 'Trains at 6am'])
})

test('the memory page adds and forgets facts', async ({ frankDb, trainerPage: chat }) => {
  await setTrainerMemory(frankDb, frank, ['Prefers dumbbells'])
  await chat.openMemory()
  await expect(chat.forgetButton('Prefers dumbbells')).toBeVisible()

  await chat.factInput.fill('Trains at 6am')
  await chat.addFactButton.click()
  await expect(chat.forgetButton('Trains at 6am')).toBeVisible()
  await chat.forgetButton('Prefers dumbbells').click()

  await expect(chat.forgetButton('Prefers dumbbells')).toBeHidden()
  await expect.poll(() => trainerMemory(frankDb, frank)).toEqual(['Trains at 6am'])
})

test('a server error shows its message, and the next question still works', async ({ trainer, trainerPage: chat }) => {
  trainer.failsWith(503, 'The trainer is resting. Try again in a minute.')
  trainer.replies('Back online.')
  await chat.goto()

  await chat.ask('First try')
  await expect(chat.bubble('The trainer is resting. Try again in a minute.')).toBeVisible()
  await chat.ask('Second try')
  await expect(chat.bubble('Back online.')).toBeVisible()

  // The error isn't sent back to the model as if the trainer had said it.
  expect(trainer.requests[1].messages.map((m) => m.role)).toEqual(['user', 'user'])
})

test('Stop cancels a slow answer, and you can ask again', async ({ trainer, trainerPage: chat }) => {
  trainer.hangs()
  trainer.replies('Here you go.')
  await chat.goto()

  await chat.ask('Take your time')
  await expect(chat.thinking).toBeVisible()
  await chat.stopButton.click()
  await expect(chat.thinking).toBeHidden()
  await expect(chat.bubble('Take your time')).toBeVisible()

  await chat.ask('Quick one')
  await expect(chat.bubble('Here you go.')).toBeVisible()
})

test('inside a workout it offers session prompts and sees the sets logged so far', async ({
  frankDb,
  trainer,
  trainerPage: chat,
  page,
}) => {
  const workoutId = await logStrengthWorkout(frankDb, {
    name: 'E2E Today',
    exercise: BENCH,
    sets: [{ weightLb: 155, reps: 8 }],
    completed: false,
  })
  trainer.replies('Strong session so far.')
  await page.goto(`/workout/${workoutId}`)

  await page.getByRole('button', { name: 'Ask a trainer' }).click()
  await chat.starter('How is this session going so far?').click()
  await expect(chat.bubble('Strong session so far.')).toBeVisible()

  expect(trainer.requests[0].context).toContain('Logged so far this session')
  expect(trainer.requests[0].context).toContain('Bench Press')
})
